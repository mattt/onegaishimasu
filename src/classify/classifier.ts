import {
  ENTRY_SCHEMA_VERSION,
  type Entry,
  type Evidence,
  type Kind,
  type Provenance,
  classificationJsonSchema,
  classificationSchema,
  deriveConfidence,
  mostSevereKind,
} from "../entry.js";
import { completeWithSchema } from "../llm/conform.js";
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from "../llm/prompt.js";
import type { Provider } from "../llm/provider.js";
import type { PullRequestInput } from "../pr.js";
import { botSignals } from "../signals/bots.js";
import { conventionalSignals } from "../signals/conventional.js";
import { DEFAULT_LABEL_MAP, type LabelMap, labelSignals } from "../signals/labels.js";
import { revertSignals } from "../signals/reverts.js";

export interface ClassifyOptions {
  /** Omit to skip inference; deterministic signals then decide everything. */
  provider?: Provider;
  labelMap?: LabelMap;
  promptVersion?: string;
  /** PR numbers not yet in a published release, for revert-cancellation. */
  unreleasedPrs?: Set<number>;
  /** Mark the entry as classified in the first-run batch. */
  firstBatch?: boolean;
  /** Called with the reason when the provider fails or its output never conforms. */
  onProviderError?: (message: string) => void;
}

function buildEntry(params: {
  pr: number;
  kind: Kind;
  evidence: Evidence[];
  summary: string;
  notes: string;
  firstBatch: boolean;
  provenance?: Provenance;
}): Entry {
  const { confidence, conflict } = deriveConfidence(params.evidence);
  return {
    schema: ENTRY_SCHEMA_VERSION,
    pr: params.pr,
    kind: params.kind,
    confidence,
    evidence: params.evidence,
    summary: params.summary,
    notes: params.notes,
    pinned: [],
    conflict,
    firstBatch: params.firstBatch,
    provenance: params.provenance,
  };
}

/**
 * Classify one merged PR into a write-once entry.
 * Deterministic signals decide what they can;
 * the model fills gaps and writes prose but never overrules an explicit signal.
 * Bot and revert-of-unreleased PRs short-circuit inference.
 * Callers own the write-once guarantee: check for an existing entry first.
 */
export async function classify(
  pr: PullRequestInput,
  options: ClassifyOptions = {},
): Promise<Entry> {
  const firstBatch = options.firstBatch ?? false;
  const labelMap = options.labelMap ?? DEFAULT_LABEL_MAP;

  // 1. Dependency-bot PRs skip inference entirely.
  const bot = botSignals(pr);
  if (bot.isBot) {
    return buildEntry({
      pr: pr.number,
      kind: "deps",
      evidence: bot.evidence,
      summary: pr.title,
      notes: "",
      firstBatch,
    });
  }

  // 2. A revert of an unreleased PR cancels: both sides become internal.
  const revert = revertSignals(pr);
  if (
    revert.isRevert &&
    revert.targetPr !== undefined &&
    options.unreleasedPrs?.has(revert.targetPr)
  ) {
    return buildEntry({
      pr: pr.number,
      kind: "internal",
      evidence: revert.evidence,
      summary: pr.title,
      notes: "",
      firstBatch,
    });
  }

  // 3. Explicit signals: conventional commits and labels.
  const conv = conventionalSignals(pr);
  const labels = labelSignals(pr, labelMap);
  const evidence: Evidence[] = [...conv.evidence, ...labels.evidence];
  if (revert.isRevert) evidence.push(...revert.evidence);

  const explicitKinds: Kind[] = [];
  if (conv.impliedKind) explicitKinds.push(conv.impliedKind);
  explicitKinds.push(...labels.impliedKinds);

  // 4. The model fills gaps and writes prose.
  let modelKind: Kind | undefined;
  let summary = pr.title;
  let notes = "";
  let provenance: Provenance | undefined;

  if (options.provider) {
    provenance = {
      model: options.provider.model,
      promptVersion: options.promptVersion ?? PROMPT_VERSION,
    };
    // An unreachable provider fails the classification, not the run:
    // the entry still lands, as `unknown` when no explicit signal exists.
    const result = await completeWithSchema(options.provider, {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(pr),
      jsonSchema: classificationJsonSchema(),
      schemaName: "classification",
      zodSchema: classificationSchema,
    }).catch((error: unknown) => ({
      ok: false as const,
      raw: "",
      errors: error instanceof Error ? error.message : String(error),
    }));
    if (!result.ok) {
      options.onProviderError?.(`PR #${pr.number}: ${result.errors}`);
    }
    if (result.ok) {
      modelKind = result.value.kind;
      summary = result.value.summary;
      notes = result.value.notes;
      evidence.push({
        source: "model",
        detail: result.value.summary,
        impliedKind: result.value.kind,
      });
    } else if (explicitKinds.length === 0) {
      // Schema failed twice and no explicit signal exists: honest failure.
      return buildEntry({
        pr: pr.number,
        kind: "unknown",
        evidence,
        summary: pr.title,
        notes: "",
        firstBatch,
        provenance,
      });
    }
  }

  // 5. Kind: explicit signals win; the model only fills a gap.
  let kind: Kind;
  if (explicitKinds.length > 0) {
    kind = mostSevereKind(explicitKinds);
  } else if (modelKind) {
    kind = modelKind;
  } else {
    kind = "unknown";
  }

  return buildEntry({
    pr: pr.number,
    kind,
    evidence,
    summary,
    notes,
    firstBatch,
    provenance,
  });
}
