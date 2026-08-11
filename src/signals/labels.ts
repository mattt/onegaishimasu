import type { Evidence, Kind } from "../entry.js";
import type { PullRequestInput } from "../pr.js";

/** A mapping from label name to the kind it asserts, from config. */
export type LabelMap = Record<string, Kind>;

/** Default label conventions, overridable via config. */
export const DEFAULT_LABEL_MAP: LabelMap = {
  breaking: "breaking",
  "breaking-change": "breaking",
  feature: "feature",
  enhancement: "feature",
  bug: "fix",
  bugfix: "fix",
  fix: "fix",
  performance: "perf",
  perf: "perf",
  dependencies: "deps",
  documentation: "docs",
  docs: "docs",
};

export interface LabelResult {
  evidence: Evidence[];
  impliedKinds: Kind[];
}

/** Turn matching PR labels into explicit evidence with implied kinds. */
export function labelSignals(
  pr: PullRequestInput,
  labelMap: LabelMap = DEFAULT_LABEL_MAP,
): LabelResult {
  const evidence: Evidence[] = [];
  const impliedKinds: Kind[] = [];

  for (const label of pr.labels) {
    const kind = labelMap[label.toLowerCase()];
    if (kind) {
      evidence.push({ source: "label", detail: label, impliedKind: kind });
      impliedKinds.push(kind);
    }
  }

  return { evidence, impliedKinds };
}
