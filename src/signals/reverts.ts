import type { Entry, Evidence } from "../entry.js";
import type { PullRequestInput } from "../pr.js";

const REVERT_TITLE_RE = /^Revert\s+"?/i;
const REVERTS_PR_RE = /Reverts?\s+#(?<pr>\d+)/i;

export interface RevertResult {
  isRevert: boolean;
  /** The PR this reverts, when it can be read from the title or body. */
  targetPr?: number;
  evidence: Evidence[];
}

/**
 * Detect a revert and, when possible, the PR it targets.
 * Whether the target is unreleased (making both entries `internal`) is the caller's call; it holds the ledger.
 */
export function revertSignals(pr: PullRequestInput): RevertResult {
  const isRevert = REVERT_TITLE_RE.test(pr.title);
  if (!isRevert) return { isRevert: false, evidence: [] };

  const bodyMatch = (pr.body ?? "").match(REVERTS_PR_RE);
  const titleMatch = pr.title.match(REVERTS_PR_RE);
  const raw = bodyMatch?.groups?.pr ?? titleMatch?.groups?.pr;
  const targetPr = raw ? Number(raw) : undefined;

  return {
    isRevert: true,
    targetPr,
    evidence: [
      {
        source: "revert",
        detail: targetPr ? `reverts #${targetPr}` : "revert",
      },
    ],
  };
}

const REVERTS_DETAIL_RE = /^reverts #(?<pr>\d+)$/;

/**
 * A revert of an unreleased PR cancels both: the classifier already marks the revert `internal`,
 * and this marks its target `internal` too, so neither reaches the notes or the version.
 * A target whose kind a person pinned keeps it.
 */
export function cancelReverts(entries: Entry[]): Entry[] {
  const targets = new Map<number, number>();
  for (const entry of entries) {
    if (entry.kind !== "internal") continue;
    for (const ev of entry.evidence) {
      const match = ev.source === "revert" ? ev.detail.match(REVERTS_DETAIL_RE) : null;
      if (match?.groups?.pr) targets.set(Number(match.groups.pr), entry.pr);
    }
  }
  if (targets.size === 0) return entries;

  return entries.map((entry) => {
    const revertedBy = targets.get(entry.pr);
    if (revertedBy === undefined || entry.pinned.includes("kind")) return entry;
    const detail = `reverted by #${revertedBy}`;
    if (entry.kind === "internal" && entry.evidence.some((e) => e.detail === detail)) return entry;
    return {
      ...entry,
      kind: "internal",
      evidence: [...entry.evidence, { source: "revert", detail, impliedKind: "internal" }],
    };
  });
}
