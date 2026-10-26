import { describe, expect, it } from "vite-plus/test";
import { ENTRY_SCHEMA_VERSION, type Entry, type Kind } from "../src/entry.js";
import { renderChangelogSection, updateChangelog } from "../src/render/changelog.js";
import {
  buildSections,
  renderAnnouncement,
  renderCredits,
  renderReleaseNotesPlain,
} from "../src/render/release-body.js";
import { mergeSections, parseSections, wrapSections } from "../src/render/sections.js";

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

describe("changelog", () => {
  it("opens the initial release with an Initial release line", () => {
    const section = renderChangelogSection("0.1.0", "2026-10-26", [entry(1, "fix")], {
      initial: true,
    });
    expect(section).toContain("### Added\n\n- Initial release.\n");
    expect(section.indexOf("### Added")).toBeLessThan(section.indexOf("### Fixed"));
  });

  it("adds no Initial release line otherwise", () => {
    const section = renderChangelogSection("1.2.0", "2026-10-26", [entry(1, "feature")]);
    expect(section).not.toContain("Initial release");
  });

  it("groups entries by keep-a-changelog category", () => {
    const section = renderChangelogSection("1.2.0", "2026-08-11", [
      entry(1, "feature"),
      entry(2, "fix"),
      entry(3, "docs"),
    ]);
    expect(section).toContain("## [1.2.0] - 2026-08-11");
    expect(section).toContain("### Added");
    expect(section).toContain("### Fixed");
    expect(section).not.toContain("Summary 3"); // docs omitted
  });

  it("marks breaking entries", () => {
    const section = renderChangelogSection("2.0.0", "2026-08-11", [entry(1, "breaking")]);
    expect(section).toContain("**Breaking:**");
  });

  it("creates a new changelog with a header", () => {
    const out = updateChangelog(null, "## [1.0.0] - 2026-08-11\n");
    expect(out).toContain("# Changelog");
    expect(out).toContain("## [1.0.0]");
  });

  it("prepends a section before existing versions", () => {
    const existing = "# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- old\n";
    const out = updateChangelog(existing, "## [1.1.0] - 2026-08-11\n\n### Added\n\n- new\n");
    expect(out.indexOf("[1.1.0]")).toBeLessThan(out.indexOf("[1.0.0]"));
  });
});

describe("release body", () => {
  it("builds grouped sections with migration notes under breaking", () => {
    const sections = buildSections([
      entry(1, "breaking", { notes: "Rename foo to bar." }),
      entry(2, "feature"),
    ]);
    const ids = sections.map((s) => s.id);
    expect(ids).toEqual(["breaking", "features"]);
    expect(sections[0]!.markdown).toContain("Rename foo to bar.");
  });

  it("lists a few dependency updates as bullets", () => {
    const sections = buildSections([entry(1, "deps"), entry(2, "deps")]);
    const deps = sections.find((s) => s.id === "deps")!;
    expect(deps.markdown.split("\n")).toHaveLength(2);
  });

  it("collapses many dependency updates to one line", () => {
    const sections = buildSections([1, 2, 3, 4].map((n) => entry(n, "deps")));
    const deps = sections.find((s) => s.id === "deps")!;
    expect(deps.markdown).toMatch(/^- 4 dependency updates: /);
    expect(deps.markdown).not.toContain("\n");
  });

  it("renders a placeholder when nothing is user-facing", () => {
    expect(renderReleaseNotesPlain([entry(1, "internal")])).toContain("No user-facing");
  });

  it("renders contributor credits", () => {
    expect(renderCredits(["bob", "alice", "bob"])).toContain("@alice, @bob");
  });

  it("renders an announcement draft with a headline and sections", () => {
    const out = renderAnnouncement("2.0.0", [
      entry(1, "breaking", { summary: "Drop legacy API", notes: "Use the new API." }),
      entry(2, "feature", { summary: "Add retries" }),
    ]);
    expect(out).toContain("## Announcing 2.0.0");
    expect(out).toContain("1 breaking change(s)");
    expect(out).toContain("### Drop legacy API");
    expect(out).toContain("Use the new API.");
  });
});

describe("section pinning", () => {
  it("round-trips unedited sections as not pinned", () => {
    const body = wrapSections(buildSections([entry(1, "feature")]));
    const parsed = parseSections(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.pinned).toBe(false);
  });

  it("detects a human edit to a section", () => {
    const body = wrapSections(buildSections([entry(1, "feature")]));
    const edited = body.replace("Summary 1", "Human rewrote this");
    const parsed = parseSections(edited);
    expect(parsed[0]!.pinned).toBe(true);
  });

  it("preserves an edited section across regeneration", () => {
    const original = wrapSections(buildSections([entry(1, "feature", { summary: "auto" })]));
    const edited = original.replace("auto", "human edit");

    // Entries changed, but the section was edited, so it stays.
    const fresh = buildSections([entry(1, "feature", { summary: "new auto" })]);
    const merged = mergeSections(fresh, edited);
    expect(merged.body).toContain("human edit");
    expect(merged.body).not.toContain("new auto");
    expect(merged.pinned).toEqual(["features"]);
  });

  it("regenerates an untouched section", () => {
    const original = wrapSections(buildSections([entry(1, "feature", { summary: "auto" })]));
    const fresh = buildSections([entry(1, "feature", { summary: "updated" })]);
    const merged = mergeSections(fresh, original);
    expect(merged.body).toContain("updated");
    expect(merged.pinned).toEqual([]);
  });
});
