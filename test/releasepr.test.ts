import { describe, expect, it } from "vite-plus/test";
import { ENTRY_SCHEMA_VERSION, type Entry, type Kind } from "../src/entry.js";
import { parseSnapshot } from "../src/ledger/snapshot.js";
import { updateManifests } from "../src/releasepr/manifests.js";
import { regenerate } from "../src/releasepr/regenerate.js";

function entry(pr: number, kind: Kind, overrides: Partial<Entry> = {}): Entry {
  return {
    schema: ENTRY_SCHEMA_VERSION,
    pr,
    kind,
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

describe("updateManifests", () => {
  it("bumps package.json to the target version", () => {
    const files = [
      { path: "package.json", content: JSON.stringify({ name: "x", version: "1.0.0" }, null, 2) },
    ];
    const [updated] = updateManifests(files, "1.1.0");
    expect(JSON.parse(updated!.content).version).toBe("1.1.0");
  });

  it("leaves unknown files unchanged", () => {
    const files = [{ path: "README.md", content: "hello" }];
    expect(updateManifests(files, "1.1.0")).toEqual(files);
  });
});

describe("regenerate", () => {
  const manifestFiles = [
    { path: "package.json", content: JSON.stringify({ name: "x", version: "1.2.0" }, null, 2) },
  ];

  it("composes a body with version reasoning and a ledger", () => {
    const result = regenerate({
      entries: [entry(1, "feature"), entry(2, "fix")],
      currentVersion: "1.2.0",
      manifestFiles,
      date: "2026-08-11",
    });
    expect(result.title).toBe("chore: release 1.3.0");
    expect(result.body).toContain("1.2.0 → 1.3.0");
    expect(result.body).toContain("Onegaishimasu ledger");
    expect(result.hasRelease).toBe(true);
    expect(JSON.parse(result.manifests[0]!.content).version).toBe("1.3.0");
  });

  it("embeds a parseable ledger snapshot in the body", () => {
    const entries = [entry(1, "feature"), entry(2, "fix")];
    const result = regenerate({
      entries,
      currentVersion: "1.2.0",
      manifestFiles,
      date: "2026-08-11",
    });
    const parsed = parseSnapshot(result.body, result.overflowComments);
    expect(parsed.map((e) => e.pr)).toEqual([1, 2]);
  });

  it("surfaces warnings for unknown entries", () => {
    const result = regenerate({
      entries: [entry(1, "unknown")],
      currentVersion: "1.2.0",
      manifestFiles,
      date: "2026-08-11",
    });
    expect(result.body).toContain("[!WARNING]");
    expect(result.body).toContain("resolve before releasing");
  });

  it("flags a first-batch run", () => {
    const result = regenerate({
      entries: [entry(1, "feature", { firstBatch: true })],
      currentVersion: "1.2.0",
      manifestFiles,
      date: "2026-08-11",
    });
    expect(result.body).toContain("first run");
  });

  it("reports no release when only docs and internal changes exist", () => {
    const result = regenerate({
      entries: [entry(1, "docs"), entry(2, "internal")],
      currentVersion: "1.2.0",
      manifestFiles,
      date: "2026-08-11",
    });
    expect(result.hasRelease).toBe(false);
    expect(result.body).toContain("No release-worthy changes");
  });

  it("preserves a human-edited notes section across regeneration", () => {
    const first = regenerate({
      entries: [entry(1, "feature", { summary: "auto summary" })],
      currentVersion: "1.2.0",
      manifestFiles,
      date: "2026-08-11",
    });
    const edited = first.body.replace("auto summary", "human summary");

    const second = regenerate({
      entries: [entry(1, "feature", { summary: "new auto summary" })],
      currentVersion: "1.2.0",
      existingBody: edited,
      manifestFiles,
      date: "2026-08-11",
    });
    // The rendered prose (before the ledger) keeps the human edit; the ledger
    // still records the entry's own summary field, which is a separate pin layer.
    const prose = second.body.split("<details>")[0]!;
    expect(prose).toContain("human summary");
    expect(prose).not.toContain("new auto summary");
    expect(second.pinnedSections).toContain("features");
  });
});
