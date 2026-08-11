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
export function renderEntryComment(entry: Entry): string {
  return [
    "Onegaishimasu classified this PR:",
    "",
    `- kind: \`${entry.kind}\` (confidence: ${entry.confidence})`,
    `- summary: ${entry.summary}`,
    "",
    "Correct it with `/onegai kind: ...`, `/onegai summary: ...`, or `/onegai notes: ...`.",
  ].join("\n");
}

async function regenerateAndUpsert(
  client: GitHubClient,
  config: Config,
  entries: Entry[],
  existingBody: string | undefined,
): Promise<void> {
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
}

/** `pull_request` closed-and-merged: classify the PR, then regenerate. */
export async function handlePullRequestMerged(
  client: GitHubClient,
  ctx: HandlerContext,
  prNumber: number,
): Promise<void> {
  const config = await client.getConfig(ctx.configPath);
  const releasePr = await client.findReleasePr(config.releaseBranch);
  let entries = releasePr ? parseSnapshot(releasePr.body, releasePr.comments) : [];

  // First run: classify the backlog since the latest release.
  if (!releasePr && entries.length === 0) {
    entries = await bootstrapEntries(client, config, ctx.provider);
  }

  // Write-once: a PR already in the ledger is never re-classified here.
  if (!entries.some((e) => e.pr === prNumber)) {
    const merged = await client.getMergedPr(prNumber);
    const rawDiff = await client.getPrDiff(prNumber).catch(() => "");
    const diff = applyDiffBudget(rawDiff, { maxChars: config.diffBudget });
    const unreleasedPrs = new Set(entries.map((e) => e.pr));
    const entry = await classify(
      { ...merged.input, diff },
      { provider: ctx.provider, labelMap: config.labels, unreleasedPrs },
    );
    entries = upsertEntry(entries, entry);

    if (config.commentOnMerge) {
      await client.postComment(prNumber, renderEntryComment(entry));
    }
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
    return;
  }

  const releasePr = await client.findReleasePr(config.releaseBranch);
  let entries: Entry[] = releasePr ? parseSnapshot(releasePr.body, releasePr.comments) : [];
  const existing = entries.find((e) => e.pr === ctx.prNumber);
  if (!existing) {
    await client.addReaction(ctx.commentId, "-1");
    return;
  }

  if (command.type === "reclassify") {
    const rawDiff = await client.getPrDiff(ctx.prNumber).catch(() => "");
    const diff = applyDiffBudget(rawDiff, { maxChars: config.diffBudget });
    const unreleasedPrs = new Set(entries.map((e) => e.pr));
    const fresh = await classify(
      { ...merged.input, diff },
      { provider: ctx.provider, labelMap: config.labels, unreleasedPrs },
    );
    // A fresh judgment, but human pins survive.
    entries = upsertEntry(entries, applyPins(fresh, existing));
  } else {
    const { entry } = applyCommand(existing, command);
    entries = upsertEntry(entries, entry);
  }

  await client.addReaction(ctx.commentId, "+1");
  await regenerateAndUpsert(client, config, entries, releasePr?.body);
}

/** `push` to the default branch: detect a merged release PR, then tag and publish. */
export async function handlePush(client: GitHubClient, ctx: HandlerContext): Promise<void> {
  const config = await client.getConfig(ctx.configPath);
  const merged = await client.getMergedReleasePr(config.releaseBranch);
  if (!merged) return;
  if (await client.tagExists(merged.version)) return;

  const notes = extractReleaseNotes(merged.body);
  await client.tagAndRelease(merged.version, notes);
}
