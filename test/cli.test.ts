import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ENTRY_SCHEMA_VERSION, type Entry } from "../src/entry.js";
import { preview, scriptPath } from "../src/cli.js";
import { writeEntryFile } from "../src/ledger/files.js";

function entry(pr: number, overrides: Partial<Entry> = {}): Entry {
  return {
    schema: ENTRY_SCHEMA_VERSION,
    pr,
    kind: "feature",
    confidence: "high",
    evidence: [],
    summary: `Summary ${pr}`,
    notes: "",
    pinned: [],
    conflict: false,
    firstBatch: false,
    ...overrides,
  };
}

describe("preview", () => {
  it("reports entries and the proposed version from a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "onegai-cli-"));
    writeEntryFile(dir, entry(1, { kind: "feature" }));
    writeEntryFile(dir, entry(2, { kind: "fix" }));

    const out = preview({ dir, current: "1.2.0" });
    expect(out).toContain("Entries (2):");
    expect(out).toContain("#1 feature");
    expect(out).toContain("Proposed version: 1.2.0 -> 1.3.0 (minor)");
    expect(out).toContain("Release notes:");
  });

  it("reports no release-worthy changes for docs only", () => {
    const dir = mkdtempSync(join(tmpdir(), "onegai-cli-"));
    writeEntryFile(dir, entry(1, { kind: "docs" }));
    const out = preview({ dir, current: "1.2.0" });
    expect(out).toContain("no release-worthy changes");
  });

  it("surfaces warnings", () => {
    const dir = mkdtempSync(join(tmpdir(), "onegai-cli-"));
    writeEntryFile(dir, entry(1, { kind: "unknown" }));
    const out = preview({ dir, current: "1.2.0" });
    expect(out).toContain("Warnings:");
    expect(out).toContain("unknown");
  });

  it("handles an empty ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "onegai-cli-"));
    const out = preview({ dir, current: "0.1.0" });
    expect(out).toContain("Entries (0):");
    expect(out).toContain("no release-worthy changes");
  });
});

describe("scriptPath", () => {
  it("resolves the symlink that npx runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "onegai-cli-"));
    writeFileSync(join(dir, "cli.cjs"), "");
    symlinkSync(join(dir, "cli.cjs"), join(dir, "onegai"));
    expect(scriptPath(join(dir, "onegai"))).toMatch(/cli\.cjs$/);
    expect(scriptPath(undefined)).toBe("");
  });
});
