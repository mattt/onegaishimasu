import { describe, expect, it } from "vite-plus/test";
import { ENTRY_SCHEMA_VERSION, type Entry } from "../src/entry.js";
import { applyCommand } from "../src/commands/apply.js";
import { parseCommand } from "../src/commands/parser.js";
import { canRunCommands } from "../src/commands/permissions.js";

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    schema: ENTRY_SCHEMA_VERSION,
    pr: 1,
    kind: "feature",
    confidence: "high",
    evidence: [],
    summary: "auto summary",
    notes: "auto notes",
    pinned: [],
    conflict: false,
    firstBatch: false,
    ...overrides,
  };
}

describe("parseCommand", () => {
  it("ignores non-commands", () => {
    expect(parseCommand("just a normal comment")).toBeNull();
  });

  it("parses a kind command", () => {
    expect(parseCommand("/onegai kind: fix")).toEqual({ type: "set-kind", value: "fix" });
  });

  it("rejects an invalid kind", () => {
    expect(parseCommand("/onegai kind: chore")).toMatchObject({ type: "invalid" });
  });

  it("parses a summary verbatim", () => {
    expect(parseCommand("/onegai summary: Fix the retry bug")).toEqual({
      type: "set-summary",
      value: "Fix the retry bug",
    });
  });

  it("takes notes from the remainder of the body", () => {
    const cmd = parseCommand("/onegai notes:\nLine one.\nLine two.");
    expect(cmd).toEqual({ type: "set-notes", value: "Line one.\nLine two." });
  });

  it("parses inline notes", () => {
    expect(parseCommand("/onegai notes: short note")).toEqual({
      type: "set-notes",
      value: "short note",
    });
  });

  it("parses pin and reclassify", () => {
    expect(parseCommand("/onegai pin")).toEqual({ type: "pin" });
    expect(parseCommand("/onegai reclassify")).toEqual({ type: "reclassify" });
  });

  it("flags unknown commands", () => {
    expect(parseCommand("/onegai frobnicate")).toMatchObject({ type: "invalid" });
  });
});

describe("permissions", () => {
  it("allows users with write access", () => {
    expect(canRunCommands({ commenter: "x", prAuthor: "y", association: "MEMBER" })).toBe(true);
  });

  it("allows the PR author to correct their own entry", () => {
    expect(canRunCommands({ commenter: "me", prAuthor: "me", association: "CONTRIBUTOR" })).toBe(
      true,
    );
  });

  it("denies an outside commenter", () => {
    expect(canRunCommands({ commenter: "stranger", prAuthor: "me", association: "NONE" })).toBe(
      false,
    );
  });
});

describe("applyCommand", () => {
  it("writes a field verbatim and pins it", () => {
    const { entry: result } = applyCommand(entry(), { type: "set-summary", value: "human" });
    expect(result.summary).toBe("human");
    expect(result.pinned).toContain("summary");
  });

  it("pins every field on pin", () => {
    const { entry: result } = applyCommand(entry(), { type: "pin" });
    expect(result.pinned.sort()).toEqual(["kind", "notes", "summary"]);
  });

  it("requests reclassification", () => {
    const { reclassify } = applyCommand(entry(), { type: "reclassify" });
    expect(reclassify).toBe(true);
  });

  it("does nothing for invalid commands", () => {
    const original = entry();
    const { entry: result } = applyCommand(original, { type: "invalid", reason: "x" });
    expect(result).toEqual(original);
  });
});
