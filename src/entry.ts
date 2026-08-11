import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Bumped only on breaking ledger changes. */
export const ENTRY_SCHEMA_VERSION = 1 as const;

/** Ordered least to most severe; the order drives severity and version bumps. */
export const KINDS = [
  "unknown",
  "internal",
  "docs",
  "deps",
  "perf",
  "fix",
  "feature",
  "breaking",
] as const;

export type Kind = (typeof KINDS)[number];

export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Every source except `model` is deterministic and outranks inference. */
export const EVIDENCE_SOURCES = [
  "conventional-commit",
  "label",
  "release-as",
  "api-diff",
  "bot",
  "revert",
  "model",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export function isDeterministicSource(source: EvidenceSource): boolean {
  return source !== "model";
}

export const evidenceSchema = z.object({
  source: z.enum(EVIDENCE_SOURCES),
  detail: z.string(),
  impliedKind: z.enum(KINDS).optional(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export const provenanceSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
});

export type Provenance = z.infer<typeof provenanceSchema>;

/** Entry fields a human may edit and thereby pin. */
export const PINNABLE_FIELDS = ["kind", "summary", "notes"] as const;
export type PinnableField = (typeof PINNABLE_FIELDS)[number];

export const entrySchema = z.object({
  schema: z.literal(ENTRY_SCHEMA_VERSION),
  pr: z.number().int().positive(),
  kind: z.enum(KINDS),
  confidence: z.enum(CONFIDENCES),
  evidence: z.array(evidenceSchema),
  summary: z.string(),
  notes: z.string(),
  /** Set of field names a human has edited; regeneration never overwrites these. */
  pinned: z.array(z.enum(PINNABLE_FIELDS)).default([]),
  /** Signals disagreed. Surfaced loudly in the release PR regardless of the winner. */
  conflict: z.boolean().default(false),
  /** Classified in the first-run batch, so nobody reviewed it while context was fresh. */
  firstBatch: z.boolean().default(false),
  provenance: provenanceSchema.optional(),
});

export type Entry = z.infer<typeof entrySchema>;

/**
 * The flat shape the model returns.
 * String enums and required fields only, to stay inside the constrained-decoding subset every provider supports.
 */
export const classificationSchema = z.object({
  kind: z.enum(KINDS),
  summary: z.string(),
  notes: z.string(),
});

export type Classification = z.infer<typeof classificationSchema>;

/** JSON Schema for constrained decoding. */
export function classificationJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(classificationSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}

export function kindSeverity(kind: Kind): number {
  return KINDS.indexOf(kind);
}

/** The most severe of the given kinds, or `unknown` when empty. */
export function mostSevereKind(kinds: Kind[]): Kind {
  return kinds.reduce<Kind>(
    (worst, k) => (kindSeverity(k) > kindSeverity(worst) ? k : worst),
    "unknown",
  );
}

export interface ConfidenceResult {
  confidence: Confidence;
  conflict: boolean;
}

/**
 * Confidence comes from evidence, never model self-report.
 * A deterministic signal is high by construction.
 * Model-only inference caps at medium.
 * No evidence is the honest failure mode and reports low.
 * Conflict is flagged when the evidence implies more than one kind.
 */
export function deriveConfidence(evidence: Evidence[]): ConfidenceResult {
  const hasDeterministic = evidence.some((e) => isDeterministicSource(e.source));
  const hasModel = evidence.some((e) => e.source === "model");

  const impliedKinds = new Set(
    evidence.map((e) => e.impliedKind).filter((k): k is Kind => k !== undefined),
  );
  const conflict = impliedKinds.size > 1;

  let confidence: Confidence;
  if (hasDeterministic) {
    confidence = "high";
  } else if (hasModel) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return { confidence, conflict };
}

export function parseEntry(value: unknown): Entry {
  return entrySchema.parse(value);
}

export function entryToYaml(entry: Entry): string {
  return stringifyYaml(entrySchema.parse(entry));
}

export function entryFromYaml(yaml: string): Entry {
  return entrySchema.parse(parseYaml(yaml));
}

export function parseClassification(value: unknown): Classification {
  return classificationSchema.parse(value);
}
