import { describe, expect, it } from "vite-plus/test";
import {
  ENTRY_SCHEMA_VERSION,
  type Entry,
  type Evidence,
  classificationJsonSchema,
  deriveConfidence,
  entryFromYaml,
  entryToYaml,
  isDeterministicSource,
  kindSeverity,
  mostSevereKind,
  parseClassification,
  parseEntry,
} from "../src/entry.js";

function baseEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    schema: ENTRY_SCHEMA_VERSION,
    pr: 482,
    kind: "feature",
    confidence: "high",
    evidence: [{ source: "conventional-commit", detail: "feat(client): add retry" }],
    summary: "Add a configurable retry policy to `Client`.",
    notes: "Requests failing with a retryable status are now retried.",
    pinned: [],
    conflict: false,
    firstBatch: false,
    ...overrides,
  };
}

describe("kind severity", () => {
  it("ranks breaking above feature above fix", () => {
    expect(kindSeverity("breaking")).toBeGreaterThan(kindSeverity("feature"));
    expect(kindSeverity("feature")).toBeGreaterThan(kindSeverity("fix"));
    expect(kindSeverity("fix")).toBeGreaterThan(kindSeverity("docs"));
  });

  it("picks the most severe applicable kind", () => {
    expect(mostSevereKind(["feature", "breaking", "fix"])).toBe("breaking");
    expect(mostSevereKind(["docs", "fix"])).toBe("fix");
    expect(mostSevereKind([])).toBe("unknown");
  });
});

describe("evidence sources", () => {
  it("treats everything but the model as deterministic", () => {
    expect(isDeterministicSource("conventional-commit")).toBe(true);
    expect(isDeterministicSource("api-diff")).toBe(true);
    expect(isDeterministicSource("model")).toBe(false);
  });
});

describe("deriveConfidence", () => {
  it("is high when a deterministic signal is present", () => {
    const evidence: Evidence[] = [
      { source: "conventional-commit", detail: "feat: x", impliedKind: "feature" },
      { source: "model", detail: "looks like a feature", impliedKind: "feature" },
    ];
    expect(deriveConfidence(evidence)).toEqual({ confidence: "high", conflict: false });
  });

  it("caps at medium for model-only inference", () => {
    const evidence: Evidence[] = [
      { source: "model", detail: "seems like a fix", impliedKind: "fix" },
    ];
    expect(deriveConfidence(evidence)).toEqual({ confidence: "medium", conflict: false });
  });

  it("is low with no evidence at all", () => {
    expect(deriveConfidence([])).toEqual({ confidence: "low", conflict: false });
  });

  it("flags conflict when evidence implies more than one kind", () => {
    const evidence: Evidence[] = [
      { source: "conventional-commit", detail: "fix: x", impliedKind: "fix" },
      { source: "model", detail: "actually a feature", impliedKind: "feature" },
    ];
    const result = deriveConfidence(evidence);
    expect(result.conflict).toBe(true);
    expect(result.confidence).toBe("high");
  });
});

describe("entry validation", () => {
  it("accepts a well-formed entry", () => {
    expect(() => parseEntry(baseEntry())).not.toThrow();
  });

  it("applies defaults for optional flags", () => {
    const parsed = parseEntry({
      schema: 1,
      pr: 1,
      kind: "fix",
      confidence: "low",
      evidence: [],
      summary: "s",
      notes: "n",
    });
    expect(parsed.pinned).toEqual([]);
    expect(parsed.conflict).toBe(false);
    expect(parsed.firstBatch).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(() => parseEntry(baseEntry({ kind: "chore" as never }))).toThrow();
  });

  it("rejects a non-positive pr number", () => {
    expect(() => parseEntry(baseEntry({ pr: 0 }))).toThrow();
  });
});

describe("classification schema", () => {
  it("accepts the flat model shape", () => {
    expect(() => parseClassification({ kind: "feature", summary: "s", notes: "n" })).not.toThrow();
  });

  it("rejects extra unexpected structure gracefully", () => {
    expect(() => parseClassification({ kind: "feature" })).toThrow();
  });

  it("exports a flat json schema with the three fields", () => {
    const schema = classificationJsonSchema() as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(["kind", "notes", "summary"]);
  });
});

describe("yaml round-trip", () => {
  it("survives serialize then parse", () => {
    const entry = baseEntry({
      pinned: ["summary"],
      provenance: { model: "gpt-4", promptVersion: "v1" },
    });
    expect(entryFromYaml(entryToYaml(entry))).toEqual(entry);
  });
});
