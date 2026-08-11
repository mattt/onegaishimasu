import type { Evidence, Kind } from "../entry.js";
import type { PullRequestInput } from "../pr.js";

/** Map a Conventional Commit type to a kind. Unlisted types are not conventional. */
const TYPE_TO_KIND: Record<string, Kind> = {
  feat: "feature",
  fix: "fix",
  perf: "perf",
  docs: "docs",
  refactor: "internal",
  style: "internal",
  test: "internal",
  tests: "internal",
  build: "internal",
  ci: "internal",
  chore: "internal",
  revert: "internal",
};

const HEADER_RE = /^(?<type>[a-zA-Z]+)(?<scope>\([^)]*\))?(?<breaking>!)?:\s?(?<subject>.+)$/;

const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/m;
const RELEASE_AS_RE = /^Release-As:\s*v?(?<version>\d+\.\d+\.\d+[^\s]*)\s*$/im;

export interface ConventionalResult {
  evidence: Evidence[];
  /** A kind implied by an explicit convention, if the title parsed. */
  impliedKind?: Kind;
  /** An explicit version override from a `Release-As` footer, if present. */
  releaseAs?: string;
}

/**
 * Parse Conventional Commit signals from the PR title and body.
 * A recognized type yields an implied kind;
 * a `!` marker or `BREAKING CHANGE:` footer overrides it to breaking.
 * These are explicit signals and outrank the model.
 */
export function conventionalSignals(pr: PullRequestInput): ConventionalResult {
  const evidence: Evidence[] = [];
  const match = pr.title.match(HEADER_RE);

  let impliedKind: Kind | undefined;

  if (match?.groups) {
    const type = match.groups.type!.toLowerCase();
    const baseKind = TYPE_TO_KIND[type];
    if (baseKind) {
      const bang = match.groups.breaking === "!";
      const breakingFooter = BREAKING_FOOTER_RE.test(pr.body ?? "");
      impliedKind = bang || breakingFooter ? "breaking" : baseKind;
      evidence.push({
        source: "conventional-commit",
        detail: pr.title,
        impliedKind,
      });
    }
  } else if (BREAKING_FOOTER_RE.test(pr.body ?? "")) {
    // A breaking footer without a conventional header still signals breaking.
    impliedKind = "breaking";
    evidence.push({
      source: "conventional-commit",
      detail: "BREAKING CHANGE footer",
      impliedKind,
    });
  }

  const releaseAsMatch = (pr.body ?? "").match(RELEASE_AS_RE);
  let releaseAs: string | undefined;
  if (releaseAsMatch?.groups?.version) {
    releaseAs = releaseAsMatch.groups.version;
    evidence.push({
      source: "release-as",
      detail: `Release-As: ${releaseAs}`,
    });
  }

  return { evidence, impliedKind, releaseAs };
}
