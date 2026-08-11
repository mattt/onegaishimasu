import { describe, expect, it } from "vite-plus/test";
import { ENTRY_SCHEMA_VERSION, type Entry, type Kind } from "../src/entry.js";
import { bumpForKind, computeBump } from "../src/version.js";

function entry(pr: number, kind: Kind, overrides: Partial<Entry> = {}): Entry {
  return {
    schema: ENTRY_SCHEMA_VERSION,
    pr,
    kind,
    confidence: "high",
    evidence: [],
    summary: "s",
    notes: "n",
    pinned: [],
    conflict: false,
    firstBatch: false,
    ...overrides,
  };
}

describe("bumpForKind", () => {
  it("maps kinds to bump levels", () => {
    expect(bumpForKind("breaking")).toBe("major");
    expect(bumpForKind("feature")).toBe("minor");
    expect(bumpForKind("fix")).toBe("patch");
    expect(bumpForKind("perf")).toBe("patch");
    expect(bumpForKind("deps")).toBe("patch");
    expect(bumpForKind("docs")).toBe("none");
    expect(bumpForKind("internal")).toBe("none");
    expect(bumpForKind("unknown")).toBe("none");
  });
});

describe("computeBump", () => {
  it("takes the max over entries", () => {
    const result = computeBump([entry(1, "fix"), entry(2, "feature"), entry(3, "docs")], "1.2.3");
    expect(result.level).toBe("minor");
    expect(result.next).toBe("1.3.0");
  });

  it("bumps major on a breaking change", () => {
    const result = computeBump([entry(1, "breaking")], "1.2.3");
    expect(result.next).toBe("2.0.0");
  });

  it("bumps nothing for docs and internal only", () => {
    const result = computeBump([entry(1, "docs"), entry(2, "internal")], "1.2.3");
    expect(result.level).toBe("none");
    expect(result.next).toBe("1.2.3");
  });

  it("records the entries that caused the bump", () => {
    const result = computeBump([entry(1, "fix"), entry(2, "feature")], "1.0.0");
    expect(result.reasons).toEqual([
      { pr: 1, kind: "fix", level: "patch" },
      { pr: 2, kind: "feature", level: "minor" },
    ]);
  });

  it("caps breaking at minor before 1.0 when configured", () => {
    const result = computeBump([entry(1, "breaking")], "0.4.2", {
      capBreakingBeforeMajor1: true,
    });
    expect(result.level).toBe("minor");
    expect(result.next).toBe("0.5.0");
  });

  it("does not cap breaking before 1.0 without the option", () => {
    const result = computeBump([entry(1, "breaking")], "0.4.2");
    expect(result.next).toBe("1.0.0");
  });

  it("warns about unknown entries", () => {
    const result = computeBump([entry(1, "unknown")], "1.0.0");
    expect(result.warnings).toContainEqual({ type: "unknown", pr: 1 });
  });

  it("warns about low-confidence breaking", () => {
    const result = computeBump([entry(1, "breaking", { confidence: "medium" })], "1.0.0");
    expect(result.warnings).toContainEqual({ type: "low-confidence-breaking", pr: 1 });
  });

  it("warns about conflicts", () => {
    const result = computeBump([entry(1, "feature", { conflict: true })], "1.0.0");
    expect(result.warnings).toContainEqual({ type: "conflict", pr: 1 });
  });

  it("honors a Release-As override", () => {
    const result = computeBump(
      [
        entry(1, "fix", {
          evidence: [{ source: "release-as", detail: "Release-As: 3.0.0" }],
        }),
      ],
      "1.2.3",
    );
    expect(result.forced).toBe(true);
    expect(result.next).toBe("3.0.0");
  });
});
