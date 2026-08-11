import type { Evidence } from "../entry.js";
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
