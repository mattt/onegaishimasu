import type { Entry, Kind } from "../entry.js";

export interface Section {
  id: string;
  title: string;
  markdown: string;
}

interface Group {
  id: string;
  title: string;
  kinds: Kind[];
}

const GROUPS: Group[] = [
  { id: "breaking", title: "Breaking changes", kinds: ["breaking"] },
  { id: "features", title: "Features", kinds: ["feature"] },
  { id: "fixes", title: "Bug fixes", kinds: ["fix"] },
  { id: "perf", title: "Performance", kinds: ["perf"] },
];

function entryProse(entry: Entry): string {
  const head = `- ${entry.summary} (#${entry.pr})`;
  if (entry.notes.trim().length === 0) return head;
  const indented = entry.notes
    .trim()
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
  return `${head}\n${indented}`;
}

/**
 * Build the grouped prose sections of a release body.
 * Breaking changes carry their migration notes; dependency bumps collapse to one line.
 * Stateless: a pure function from entries to sections.
 */
export function buildSections(entries: Entry[]): Section[] {
  const sections: Section[] = [];

  for (const group of GROUPS) {
    const matching = entries.filter((e) => group.kinds.includes(e.kind));
    if (matching.length === 0) continue;
    const markdown = matching.map(entryProse).join("\n");
    sections.push({ id: group.id, title: group.title, markdown });
  }

  // A few dependency updates read best as bullets; many collapse to one line.
  const deps = entries.filter((e) => e.kind === "deps");
  if (deps.length > 0) {
    const markdown =
      deps.length <= 3
        ? deps.map((e) => `- ${e.summary} (#${e.pr})`).join("\n")
        : `- ${deps.length} dependency updates: ${deps.map((e) => `${e.summary} (#${e.pr})`).join("; ")}`;
    sections.push({ id: "deps", title: "Dependencies", markdown });
  }

  return sections;
}

/** Render sections as plain markdown, for previews and non-pinned output. */
export function renderReleaseNotesPlain(entries: Entry[]): string {
  const sections = buildSections(entries);
  if (sections.length === 0) return "_No user-facing changes._";
  return sections.map((s) => `### ${s.title}\n\n${s.markdown}`).join("\n\n");
}

/**
 * A blog-post-shaped announcement draft for minor and major releases.
 * A stateless template; the prose layer is meant to improve without touching stored judgment.
 */
export function renderAnnouncement(version: string, entries: Entry[]): string {
  const features = entries.filter((e) => e.kind === "feature");
  const breaking = entries.filter((e) => e.kind === "breaking");
  const fixes = entries.filter((e) => e.kind === "fix");

  const parts = [`## Announcing ${version}`, ""];
  const headline: string[] = [];
  if (breaking.length > 0) headline.push(`${breaking.length} breaking change(s)`);
  if (features.length > 0) headline.push(`${features.length} new feature(s)`);
  if (fixes.length > 0) headline.push(`${fixes.length} fix(es)`);
  parts.push(
    headline.length > 0
      ? `This release brings ${headline.join(", ")}.`
      : "This release contains internal changes.",
  );

  for (const e of [...breaking, ...features]) {
    parts.push("", `### ${e.summary}`, "", e.notes.trim() || "_No details provided._");
  }
  return parts.join("\n");
}

/** Render a compact credits line from contributor logins. */
export function renderCredits(logins: string[]): string {
  const unique = [...new Set(logins)].filter((l) => l.length > 0).sort();
  if (unique.length === 0) return "";
  return `### Contributors\n\n${unique.map((l) => `@${l}`).join(", ")}`;
}
