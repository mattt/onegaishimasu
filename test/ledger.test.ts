import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ENTRY_SCHEMA_VERSION, type Entry } from "../src/entry.js";
import {
  artifactName,
  parseEntryArtifact,
  serializeEntryArtifact,
} from "../src/ledger/artifacts.js";
import { readEntryDir, writeEntryFile } from "../src/ledger/files.js";
import { applyPins, detectPins, mergePinned } from "../src/ledger/pinning.js";
import { hasSnapshot, parseSnapshot, serializeSnapshot } from "../src/ledger/snapshot.js";

function entry(pr: number, overrides: Partial<Entry> = {}): Entry {
  return {
    schema: ENTRY_SCHEMA_VERSION,
    pr,
    kind: "feature",
    confidence: "high",
    evidence: [{ source: "conventional-commit", detail: "feat: x" }],
    summary: `Summary for ${pr}`,
    notes: `Notes for ${pr}`,
    pinned: [],
    conflict: false,
    firstBatch: false,
    ...overrides,
  };
}

describe("snapshot round-trip", () => {
  it("serializes to a single chunk and parses back", () => {
    const entries = [entry(1), entry(2), entry(3)];
    const chunks = serializeSnapshot(entries);
    expect(chunks).toHaveLength(1);
    expect(hasSnapshot(chunks[0]!)).toBe(true);
    expect(parseSnapshot(chunks[0]!)).toEqual(entries);
  });

  it("handles an empty ledger", () => {
    const chunks = serializeSnapshot([]);
    expect(chunks).toHaveLength(1);
    expect(parseSnapshot(chunks[0]!)).toEqual([]);
  });

  it("ignores surrounding prose in the body", () => {
    const entries = [entry(7)];
    const chunk = serializeSnapshot(entries)[0]!;
    const body = `## Release 1.2.0\n\nSome notes here.\n\n<details>\n${chunk}\n</details>\n`;
    expect(parseSnapshot(body)).toEqual(entries);
  });
});

describe("snapshot spill", () => {
  it("splits into multiple chunks under a small budget and reassembles in order", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i + 1));
    const chunks = serializeSnapshot(entries, 400);
    expect(chunks.length).toBeGreaterThan(1);

    // First chunk goes in the body, the rest into comments.
    const [body, ...comments] = chunks;
    const reassembled = parseSnapshot(body!, comments);
    expect(reassembled.map((e) => e.pr)).toEqual(entries.map((e) => e.pr));
  });

  it("keeps every chunk within the budget", () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(i + 1));
    const budget = 1000;
    const chunks = serializeSnapshot(entries, budget);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(budget);
    }
  });
});

describe("pinning", () => {
  it("detects a single edited field", () => {
    const original = entry(1, { summary: "auto summary" });
    const edited = entry(1, { summary: "human summary" });
    expect(detectPins(original, edited)).toEqual(["summary"]);
  });

  it("detects multiple edited fields", () => {
    const original = entry(1, { kind: "fix", summary: "a", notes: "b" });
    const edited = entry(1, { kind: "feature", summary: "a", notes: "c" });
    expect(detectPins(original, edited).sort()).toEqual(["kind", "notes"]);
  });

  it("merges pins without duplicates", () => {
    const merged = mergePinned(entry(1, { pinned: ["summary"] }), ["summary", "notes"]);
    expect(merged.pinned.sort()).toEqual(["notes", "summary"]);
  });

  it("preserves pinned fields when applying a regeneration", () => {
    const existing = entry(1, { summary: "human summary", pinned: ["summary"] });
    const generated = entry(1, { summary: "new auto summary", notes: "new notes" });
    const result = applyPins(generated, existing);
    expect(result.summary).toBe("human summary");
    expect(result.notes).toBe("new notes");
    expect(result.pinned).toEqual(["summary"]);
  });
});

describe("artifacts", () => {
  it("names artifacts by merge SHA", () => {
    expect(artifactName("abc123")).toBe("onegai-entry-abc123");
  });

  it("round-trips an entry through the artifact serializer", () => {
    const e = entry(42);
    expect(parseEntryArtifact(serializeEntryArtifact(e))).toEqual(e);
  });
});

describe("entry directory", () => {
  it("writes and reads back entries sorted by PR", () => {
    const dir = mkdtempSync(join(tmpdir(), "onegai-files-"));
    writeEntryFile(dir, entry(3));
    writeEntryFile(dir, entry(1));
    writeEntryFile(dir, entry(2));
    expect(readEntryDir(dir).map((e) => e.pr)).toEqual([1, 2, 3]);
  });

  it("returns an empty list for a missing directory", () => {
    expect(readEntryDir(join(tmpdir(), "does-not-exist-onegai"))).toEqual([]);
  });
});
