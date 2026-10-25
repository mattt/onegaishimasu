import { bootstrapEntries } from "../bootstrap.js";
import { classify } from "../classify/classifier.js";
import { applyDiffBudget } from "../classify/diff-budget.js";
import { applyCommand } from "../commands/apply.js";
import { parseCommand } from "../commands/parser.js";
import { canRunCommands } from "../commands/permissions.js";
import type { Config } from "../config.js";
import type { Entry } from "../entry.js";
import { applyPins } from "../ledger/pinning.js";
import { parseSnapshot } from "../ledger/snapshot.js";
import type { Provider } from "../llm/provider.js";
import { regenerate } from "../releasepr/regenerate.js";
import type { GitHubClient } from "./api.js";

export interface HandlerContext {
  configPath: string;
  provider?: Provider;
  /** Surfaces problems a maintainer must fix, such as a failing provider. */
  warn?: (message: string) => void;
}

/** Insert or replace an entry by PR number, keeping the list sorted. */
export function upsertEntry(entries: Entry[], entry: Entry): Entry[] {
  const next = entries.filter((e) => e.pr !== entry.pr);
  next.push(entry);
  return next.sort((a, b) => a.pr - b.pr);
}

/** Extract the human-readable release notes from a release PR body. */
export function extractReleaseNotes(body: string): string {
  const start = body.indexOf("## Release notes");
  if (start === -1) return body;
  const after = body.slice(start + "## Release notes".length);
  const end = after.indexOf("<details>");
  return (end === -1 ? after : after.slice(0, end)).trim();
}

/** A compact rendering of an entry for the comment left on the merged PR. */
export function renderEntryComment(entry: Entry, releasePr?: number): string {
  const sources = [...new Set(entry.evidence.map((e) => e.source))].join(", ") || "none";
  const lines = [
    releasePr
      ? `Onegaishimasu added this PR to the release in #${releasePr}:`
      : "Onegaishimasu classified this PR:",
    "",
    `- kind: \`${entry.kind}\` (confidence: ${entry.confidence}; evidence: ${sources})`,
    `- summary: ${entry.summary}`,
  ];
  if (entry.notes.trim().length > 0) {
    lines.push(
      "",
      "<details>",
      "<summary>Release notes</summary>",
      "",
      entry.notes.trim(),
      "</details>",
    );
  }
  lines.push(
    "",
    "Until the release merges, the PR author or anyone with write access can correct this",
    "with a comment such as `/onegai kind: fix`, `/onegai summary: <one line>`,",
    "or `/onegai notes:` followed by the notes on the next lines.",
  );
  return lines.join("\n");
}

async function regenerateAndUpsert(
  client: GitHubClient,
  config: Config,
  entries: Entry[],
  existingBody: string | undefined,
): Promise<number> {
  const defaultBranch = await client.getDefaultBranch();
  const manifestPath = config.manifestFiles[0] ?? "package.json";
  const currentVersion = await client.getCurrentVersion(manifestPath);
  const manifestFiles = await client.getManifestFiles(config.manifestFiles);
  const changelog = await client.getChangelog();

  const result = regenerate({
    entries,
    currentVersion,
    existingBody,
    manifestFiles,
    existingChangelog: changelog,
    options: {
      capBreakingBeforeMajor1: config.preOneZero.capBreakingAtMinor,
      credits: config.render.credits,
      announcement: config.render.announcement,
    },
  });

  const files = [...result.manifests, { path: "CHANGELOG.md", content: result.changelog }];

  const prNumber = await client.upsertReleasePr({
    branch: config.releaseBranch,
    baseBranch: defaultBranch,
    title: result.title,
    body: result.body,
    files,
    overflowComments: result.overflowComments,
  });

  for (const comment of result.overflowComments) {
    await client.postComment(prNumber, comment);
  }
  return prNumber;
}

/** `pull_request` closed-and-merged: classify the PR, then regenerate. */
export async function handlePullRequestMerged(
  client: GitHubClient,
  ctx: HandlerContext,
  prNumber: number,
): Promise<void> {
  const config = await client.getConfig(ctx.configPath);
  const merged = await client.getMergedPr(prNumber);

  // The release PR's own merge is handled by the push handler.
  // Classifying it here would open the next release PR with the changes just released.
  if (merged.headRef === config.releaseBranch) return;

  const releasePr = await client.findReleasePr(config.releaseBranch);
  let entries = releasePr ? parseSnapshot(releasePr.body, releasePr.comments) : [];

  // A new cycle: classify the merges since the latest release, this one included.
  let isNew = false;
  if (!releasePr && entries.length === 0) {
    entries = await bootstrapEntries(client, config, ctx.provider, {
      onProviderError: ctx.warn,
    });
    isNew = entries.some((e) => e.pr === prNumber);
  }

  // Write-once: a PR already in the ledger is never re-classified here.
  if (!entries.some((e) => e.pr === prNumber)) {
    const rawDiff = await client.getPrDiff(prNumber).catch(() => "");
    const diff = applyDiffBudget(rawDiff, { maxChars: config.diffBudget });
    const unreleasedPrs = new Set(entries.map((e) => e.pr));
    const entry = await classify(
      { ...merged.input, diff },
      {
        provider: ctx.provider,
        labelMap: config.labels,
        unreleasedPrs,
        onProviderError: ctx.warn,
      },
    );
    entries = upsertEntry(entries, entry);
    isNew = true;
  }

  const releasePrNumber = await regenerateAndUpsert(client, config, entries, releasePr?.body);

  const entry = entries.find((e) => e.pr === prNumber);
  if (isNew && entry && config.commentOnMerge) {
    await client.postComment(prNumber, renderEntryComment(entry, releasePrNumber));
  }
}

/**
 * `workflow_dispatch`: rebuild the release PR from the merges since the latest release.
 * Every entry is classified again with the current prompt and provider;
 * fields a person corrected keep their corrections.
 */
export async function handleRebuild(client: GitHubClient, ctx: HandlerContext): Promise<void> {
  const config = await client.getConfig(ctx.configPath);
  const releasePr = await client.findReleasePr(config.releaseBranch);
  const previous = releasePr ? parseSnapshot(releasePr.body, releasePr.comments) : [];

  let entries = await bootstrapEntries(client, config, ctx.provider, {
    onProviderError: ctx.warn,
  });
  entries = entries.map((fresh) => {
    const prior = previous.find((e) => e.pr === fresh.pr);
    return prior ? applyPins(fresh, prior) : fresh;
  });

  if (entries.length === 0 && !releasePr) {
    ctx.warn?.("No merged PRs since the latest release; there is nothing to rebuild.");
    return;
  }
  await regenerateAndUpsert(client, config, entries, releasePr?.body);
}

export interface CommentContext extends HandlerContext {
  prNumber: number;
  commentId: number;
  commentBody: string;
  commenter: string;
  association: string;
}

/** `issue_comment` created: parse a command and apply it, model-free. */
export async function handleIssueComment(client: GitHubClient, ctx: CommentContext): Promise<void> {
  const command = parseCommand(ctx.commentBody);
  if (!command) return;

  const config = await client.getConfig(ctx.configPath);
  const merged = await client.getMergedPr(ctx.prNumber);
  const prAuthor = merged.input.author;

  if (
    !canRunCommands({
      commenter: ctx.commenter,
      prAuthor,
      association: ctx.association,
    })
  ) {
    await client.addReaction(ctx.commentId, "-1");
    return;
  }

  if (command.type === "invalid") {
    await client.addReaction(ctx.commentId, "-1");
    await client.postComment(
      ctx.prNumber,
      `Onegaishimasu couldn't run that command (${command.reason}). ` +
        "Try `/onegai kind: fix`, `/onegai summary: <one line>`, `/onegai notes:`, " +
        "`/onegai pin`, or `/onegai reclassify`.",
    );
    return;
  }

  const releasePr = await client.findReleasePr(config.releaseBranch);
  let entries: Entry[] = releasePr ? parseSnapshot(releasePr.body, releasePr.comments) : [];
  const existing = entries.find((e) => e.pr === ctx.prNumber);
  if (!existing) {
    await client.addReaction(ctx.commentId, "-1");
    await client.postComment(
      ctx.prNumber,
      "Onegaishimasu has no unreleased entry for this PR, so there is nothing to correct. " +
        "It may already be part of a published release.",
    );
    return;
  }

  if (command.type === "reclassify") {
    const rawDiff = await client.getPrDiff(ctx.prNumber).catch(() => "");
    const diff = applyDiffBudget(rawDiff, { maxChars: config.diffBudget });
    const unreleasedPrs = new Set(entries.map((e) => e.pr));
    const fresh = await classify(
      { ...merged.input, diff },
      {
        provider: ctx.provider,
        labelMap: config.labels,
        unreleasedPrs,
        onProviderError: ctx.warn,
      },
    );
    // A fresh judgment, but human pins survive.
    entries = upsertEntry(entries, applyPins(fresh, existing));
  } else {
    const { entry } = applyCommand(existing, command);
    entries = upsertEntry(entries, entry);
  }

  await regenerateAndUpsert(client, config, entries, releasePr?.body);
  await client.addReaction(ctx.commentId, "+1");
}

/** `push` to the default branch: detect a merged release PR, then tag and publish. */
export async function handlePush(client: GitHubClient, ctx: HandlerContext): Promise<void> {
  const config = await client.getConfig(ctx.configPath);
  const merged = await client.getMergedReleasePr(config.releaseBranch);
  if (!merged) return;

  // The merged manifest is what ships, so it decides the tag.
  // The PR title is only a fallback, because a person can edit it.
  const manifestPath = config.manifestFiles[0] ?? "package.json";
  const version =
    (await client.getManifestVersion(manifestPath, merged.mergeSha)) ?? merged.version;
  if (!version) {
    ctx.warn?.(`Release PR #${merged.number} merged, but no version was found to tag.`);
    return;
  }
  if (await client.tagExists(version)) return;

  const notes = extractReleaseNotes(merged.body);
  await client.tagAndRelease(version, notes, merged.mergeSha);
}
