import { describe, expect, it } from "vite-plus/test";
import { ENTRY_SCHEMA_VERSION, type Entry, type Kind } from "../src/entry.js";
import { parseSnapshot } from "../src/ledger/snapshot.js";
import { updateManifests } from "../src/releasepr/manifests.js";
import { extractReleaseNotes } from "../src/github/handlers.js";
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
    expect(result.body).toContain("first release");
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

describe("release notes introduction", () => {
  const manifestFiles = [
    { path: "package.json", content: JSON.stringify({ name: "x", version: "1.2.0" }, null, 2) },
  ];
  const intro = "This release adds retries.\n\nSee the [README](#) to set it up.";

  function withIntro(body: string): string {
    return body.replace("## Release notes\n\n", `## Release notes\n\n${intro}\n\n`);
  }

  it("keeps an introduction above the sections and publishes it", () => {
    const entries = [entry(1, "feature"), entry(2, "fix")];
    const first = regenerate({ entries, currentVersion: "1.2.0", manifestFiles });
    const second = regenerate({
      entries: [...entries, entry(3, "fix")],
      currentVersion: "1.2.0",
      manifestFiles,
      existingBody: withIntro(first.body),
    });

    const notes = extractReleaseNotes(second.body);
    expect(notes.startsWith(intro)).toBe(true);
    expect(notes).toContain("Summary 3 (#3)");
    expect(second.body.split(intro)).toHaveLength(2);
  });

  it("keeps an introduction from a body with CRLF line endings", () => {
    const first = regenerate({
      entries: [entry(1, "fix")],
      currentVersion: "1.2.0",
      manifestFiles,
    });
    const second = regenerate({
      entries: [entry(1, "fix")],
      currentVersion: "1.2.0",
      manifestFiles,
      existingBody: withIntro(first.body).replace(/\n/g, "\r\n"),
    });
    expect(extractReleaseNotes(second.body).startsWith(intro)).toBe(true);
  });

  it("keeps an introduction when there are no user-facing changes", () => {
    const first = regenerate({
      entries: [entry(1, "docs")],
      currentVersion: "1.2.0",
      manifestFiles,
    });
    const second = regenerate({
      entries: [entry(1, "docs")],
      currentVersion: "1.2.0",
      manifestFiles,
      existingBody: withIntro(first.body),
    });
    expect(second.body).toContain(`${intro}\n\n_No user-facing changes._`);
  });

  it("adds nothing when no one wrote an introduction", () => {
    const first = regenerate({
      entries: [entry(1, "fix")],
      currentVersion: "1.2.0",
      manifestFiles,
    });
    const second = regenerate({
      entries: [entry(1, "fix")],
      currentVersion: "1.2.0",
      manifestFiles,
      existingBody: first.body,
    });
    expect(second.body).toBe(first.body);
  });
});

describe("initial release", () => {
  const zero = [
    { path: "package.json", content: JSON.stringify({ name: "x", version: "0.0.0" }, null, 2) },
  ];

  it("marks the first release after 0.0.0 in the changelog", () => {
    const result = regenerate({
      entries: [entry(1, "feature")],
      currentVersion: "0.0.0",
      manifestFiles: zero,
    });
    expect(result.changelog).toContain("## [0.1.0]");
    expect(result.changelog).toContain("- Initial release.");
  });

  it("does not mark a later release", () => {
    const result = regenerate({
      entries: [entry(1, "feature")],
      currentVersion: "1.0.9",
      manifestFiles: zero,
    });
    expect(result.changelog).not.toContain("Initial release");
  });
});
