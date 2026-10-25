import type { Entry } from "../entry.js";
import { serializeSnapshot } from "../ledger/snapshot.js";
import { renderChangelogSection, updateChangelog } from "../render/changelog.js";
import { buildSections, renderAnnouncement, renderCredits } from "../render/release-body.js";
import { mergeSections } from "../render/sections.js";
import { type BumpResult, type BumpWarning, computeBump } from "../version.js";
import { type ManifestFile, updateManifests } from "./manifests.js";

export interface RegenerateInput {
  entries: Entry[];
  currentVersion: string;
  /** The current release PR body, for section-level pin detection. */
  existingBody?: string;
  manifestFiles: ManifestFile[];
  existingChangelog?: string | null;
  contributors?: string[];
  /** Injectable for deterministic output. Defaults to today (UTC). */
  date?: string;
  options?: {
    capBreakingBeforeMajor1?: boolean;
    credits?: boolean;
    announcement?: boolean;
  };
}

export interface RegenerationResult {
  bump: BumpResult;
  title: string;
  body: string;
  /** Ledger chunks that overflowed the body, to be posted as bot comments. */
  overflowComments: string[];
  changelog: string;
  manifests: ManifestFile[];
  /** True when there is a release-worthy bump. */
  hasRelease: boolean;
  pinnedSections: string[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderWarnings(warnings: BumpWarning[], firstBatch: boolean): string {
  if (warnings.length === 0 && !firstBatch) return "";
  const lines: string[] = ["> [!WARNING]"];
  if (firstBatch) {
    lines.push(
      "> This is the first release, so most entries were classified without a comment on their PR. Check each one below, and correct it with a `/onegai` command on its PR.",
    );
  }
  for (const w of warnings) {
    switch (w.type) {
      case "unknown":
        lines.push(`> - #${w.pr}: classified \`unknown\` — resolve before releasing.`);
        break;
      case "low-confidence-breaking":
        lines.push(`> - #${w.pr}: model-detected breaking change at low confidence — verify.`);
        break;
      case "conflict":
        lines.push(`> - #${w.pr}: signals conflict — verify the kind.`);
        break;
    }
  }
  return lines.join("\n");
}

function renderReasoning(bump: BumpResult): string {
  if (!bump.forced && bump.level === "none") {
    return "No release-worthy changes yet.";
  }
  const header = bump.forced
    ? `Proposed version: **${bump.current} → ${bump.next}** (set by \`Release-As\` in #${bump.forcedBy})`
    : `Proposed version: **${bump.current} → ${bump.next}** (${bump.level})`;
  const causes = bump.reasons.map((r) => `- #${r.pr} ${r.kind} (${r.level})`);
  return causes.length > 0 ? `${header}\n\nCaused by:\n${causes.join("\n")}` : header;
}

/**
 * Regenerate the release PR artifacts from the current entry set:
 * version and reasoning, warnings, rendered notes flowing around pinned sections, the ledger snapshot, the changelog, and updated manifests.
 * Pure and re-runnable; the GitHub side applies the result.
 */
export function regenerate(input: RegenerateInput): RegenerationResult {
  const date = input.date ?? today();
  const bump = computeBump(input.entries, input.currentVersion, {
    capBreakingBeforeMajor1: input.options?.capBreakingBeforeMajor1,
  });

  const hasRelease = bump.forced || bump.level !== "none";
  const firstBatch = input.entries.some((e) => e.firstBatch);

  // Notes prose, preserving human-edited sections.
  const sections = buildSections(input.entries);
  const merged = mergeSections(sections, input.existingBody ?? "");
  const credits = input.options?.credits !== false ? renderCredits(input.contributors ?? []) : "";
  const announcement =
    input.options?.announcement && (bump.level === "minor" || bump.level === "major")
      ? `<details>\n<summary>Announcement draft</summary>\n\n${renderAnnouncement(bump.next, input.entries)}\n</details>`
      : "";

  // Ledger snapshot: first chunk in the body, overflow into comments.
  const chunks = serializeSnapshot(input.entries);
  const [ledgerHead, ...overflow] = chunks;

  const bodyParts = [
    `## Release ${bump.next}`,
    renderReasoning(bump),
    renderWarnings(bump.warnings, firstBatch),
    "## Release notes",
    merged.body || "_No user-facing changes._",
    credits,
    announcement,
    `<details>\n<summary>Onegaishimasu ledger</summary>\n\n${ledgerHead ?? ""}\n</details>`,
  ].filter((p) => p.trim().length > 0);

  const changelogSection = renderChangelogSection(bump.next, date, input.entries);
  const changelog = updateChangelog(input.existingChangelog ?? null, changelogSection);
  const manifests = hasRelease
    ? updateManifests(input.manifestFiles, bump.next)
    : input.manifestFiles;

  return {
    bump,
    title: `chore: release ${bump.next}`,
    body: bodyParts.join("\n\n"),
    overflowComments: overflow,
    changelog,
    manifests,
    hasRelease,
    pinnedSections: merged.pinned,
  };
}
