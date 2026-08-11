import type { Entry, Kind } from "../entry.js";

/** keep-a-changelog category per kind; `null` is omitted from the changelog. */
const CATEGORY: Record<Kind, string | null> = {
  breaking: "Changed",
  feature: "Added",
  fix: "Fixed",
  perf: "Changed",
  deps: "Changed",
  docs: null,
  internal: null,
  unknown: null,
};

const CATEGORY_ORDER = ["Added", "Changed", "Fixed", "Removed", "Deprecated", "Security"];

function line(entry: Entry): string {
  const marker = entry.kind === "breaking" ? "**Breaking:** " : "";
  return `- ${marker}${entry.summary} (#${entry.pr})`;
}

/** One terse line per entry, grouped by category, omitting kinds that bump nothing. */
export function renderChangelogSection(version: string, date: string, entries: Entry[]): string {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const category = CATEGORY[entry.kind];
    if (!category) continue;
    const list = groups.get(category) ?? [];
    list.push(line(entry));
    groups.set(category, list);
  }

  const parts = [`## [${version}] - ${date}`];
  for (const category of CATEGORY_ORDER) {
    const list = groups.get(category);
    if (!list || list.length === 0) continue;
    parts.push("", `### ${category}`, "", ...list);
  }
  return `${parts.join("\n")}\n`;
}

const HEADER = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`;

/** Insert a section before the first existing version, adding a header when the file is absent. */
export function updateChangelog(existing: string | null, section: string): string {
  if (!existing || existing.trim().length === 0) {
    return `${HEADER}\n${section}`;
  }
  const idx = existing.search(/^## /m);
  if (idx === -1) {
    return `${existing.trimEnd()}\n\n${section}`;
  }
  return `${existing.slice(0, idx)}${section}\n${existing.slice(idx)}`;
}
