import type { Evidence } from "../entry.js";
import type { PullRequestInput } from "../pr.js";

const BOT_AUTHORS = new Set([
  "dependabot[bot]",
  "dependabot-preview[bot]",
  "renovate[bot]",
  "renovate-bot",
]);

const DEPS_TITLE_RE = /^(chore|build|fix)?\(?deps(-dev)?\)?:?\s|^(bump|update)\s.+\s(from|to)\s/i;

export interface BotResult {
  isBot: boolean;
  evidence: Evidence[];
}

/** Detect dependency-bot PRs: classified `deps` by author and title pattern, skipping inference. */
export function botSignals(pr: PullRequestInput): BotResult {
  const byAuthor = BOT_AUTHORS.has(pr.author.toLowerCase());
  const byTitle = DEPS_TITLE_RE.test(pr.title);

  if (byAuthor || byTitle) {
    const reason = byAuthor ? `bot author ${pr.author}` : "dependency bump title";
    return {
      isBot: true,
      evidence: [{ source: "bot", detail: reason, impliedKind: "deps" }],
    };
  }
  return { isBot: false, evidence: [] };
}
