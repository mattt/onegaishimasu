import semver from "semver";
import type { Entry, Kind } from "./entry.js";

export type BumpLevel = "none" | "patch" | "minor" | "major";

const LEVEL_RANK: Record<BumpLevel, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

/** The bump a kind implies, before pre-1.0 capping. */
export function bumpForKind(kind: Kind): BumpLevel {
  switch (kind) {
    case "breaking":
      return "major";
    case "feature":
      return "minor";
    case "fix":
    case "perf":
    case "deps":
      return "patch";
    default:
      return "none";
  }
}

export interface VersionOptions {
  /** Before 1.0.0, cap breaking changes at a minor bump. */
  capBreakingBeforeMajor1?: boolean;
}

export interface BumpReason {
  pr: number;
  kind: Kind;
  level: BumpLevel;
}

export type BumpWarning =
  | { type: "unknown"; pr: number }
  | { type: "low-confidence-breaking"; pr: number }
  | { type: "conflict"; pr: number };

export interface BumpResult {
  current: string;
  next: string;
  level: BumpLevel;
  reasons: BumpReason[];
  warnings: BumpWarning[];
  /** Set when a `Release-As` footer forced an exact version. */
  forced: boolean;
}

function readReleaseAs(entries: Entry[]): string | null {
  let best: string | null = null;
  for (const entry of entries) {
    for (const ev of entry.evidence) {
      if (ev.source !== "release-as") continue;
      const version = ev.detail.replace(/^Release-As:\s*v?/i, "").trim();
      if (semver.valid(version) && (best === null || semver.gt(version, best))) {
        best = version;
      }
    }
  }
  return best;
}

/**
 * The proposed version is the max bump over entries, with the entries that caused it.
 * `unknown` bumps nothing but renders as a blocker;
 * low-confidence breaking and conflicts are surfaced loudly, not applied silently.
 */
export function computeBump(
  entries: Entry[],
  current: string,
  options: VersionOptions = {},
): BumpResult {
  const normalizedCurrent = semver.valid(current) ?? "0.0.0";
  const preMajor1 = semver.lt(normalizedCurrent, "1.0.0");

  const reasons: BumpReason[] = [];
  const warnings: BumpWarning[] = [];
  let level: BumpLevel = "none";

  for (const entry of entries) {
    let entryLevel = bumpForKind(entry.kind);

    if (entry.kind === "breaking" && preMajor1 && options.capBreakingBeforeMajor1) {
      entryLevel = "minor";
    }

    if (entryLevel !== "none") {
      reasons.push({ pr: entry.pr, kind: entry.kind, level: entryLevel });
      if (LEVEL_RANK[entryLevel] > LEVEL_RANK[level]) level = entryLevel;
    }

    if (entry.kind === "unknown") warnings.push({ type: "unknown", pr: entry.pr });
    if (entry.kind === "breaking" && entry.confidence !== "high") {
      warnings.push({ type: "low-confidence-breaking", pr: entry.pr });
    }
    if (entry.conflict) warnings.push({ type: "conflict", pr: entry.pr });
  }

  const forcedVersion = readReleaseAs(entries);
  if (forcedVersion) {
    return {
      current: normalizedCurrent,
      next: forcedVersion,
      level,
      reasons,
      warnings,
      forced: true,
    };
  }

  const next =
    level === "none"
      ? normalizedCurrent
      : (semver.inc(normalizedCurrent, level) ?? normalizedCurrent);

  return {
    current: normalizedCurrent,
    next,
    level,
    reasons,
    warnings,
    forced: false,
  };
}
