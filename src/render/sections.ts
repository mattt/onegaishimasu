import { createHash } from "node:crypto";
import type { Section } from "./release-body.js";

/**
 * Section-level pinning for rendered prose.
 * Each section carries a hash of the content the generator wrote.
 * Next run, a section whose content no longer matches its hash was edited and is preserved verbatim;
 * untouched sections regenerate freely.
 */

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function startMarker(id: string, h: string): string {
  return `<!-- onegai:section id=${id} hash=${h} -->`;
}

function endMarker(id: string): string {
  return `<!-- /onegai:section id=${id} -->`;
}

/** Wrap one section with markers that record a hash of its content. */
export function wrapSection(section: Section): string {
  const content = `### ${section.title}\n\n${section.markdown}`;
  return `${startMarker(section.id, hash(content))}\n${content}\n${endMarker(section.id)}`;
}

/** Join wrapped sections into a single prose block. */
export function wrapSections(sections: Section[]): string {
  return sections.map(wrapSection).join("\n\n");
}

export interface ParsedSection {
  id: string;
  content: string;
  pinned: boolean;
}

const SECTION_RE =
  /<!-- onegai:section id=(?<id>[a-z-]+) hash=(?<hash>[a-z0-9]+) -->\n(?<content>[\s\S]*?)\n<!-- \/onegai:section id=\k<id> -->/g;

/** Parse wrapped sections from a body, flagging those a human has edited. */
export function parseSections(body: string): ParsedSection[] {
  const parsed: ParsedSection[] = [];
  // Bodies saved from GitHub's web editor use CRLF line endings.
  for (const match of body.replace(/\r\n/g, "\n").matchAll(SECTION_RE)) {
    const g = match.groups!;
    const content = g.content!;
    parsed.push({
      id: g.id!,
      content,
      pinned: hash(content) !== g.hash,
    });
  }
  return parsed;
}

/**
 * Merge freshly rendered sections with an existing body.
 * Edited sections are kept verbatim; the rest take the fresh render.
 * Returns the merged prose and the pinned ids.
 */
export function mergeSections(
  fresh: Section[],
  existingBody: string,
): { body: string; pinned: string[] } {
  const existing = new Map(parseSections(existingBody).map((s) => [s.id, s]));
  const pinned: string[] = [];

  const rendered = fresh.map((section) => {
    const prior = existing.get(section.id);
    if (prior?.pinned) {
      pinned.push(section.id);
      return `${startMarker(section.id, "pinned")}\n${prior.content}\n${endMarker(section.id)}`;
    }
    return wrapSection(section);
  });

  return { body: rendered.join("\n\n"), pinned };
}

const NOTES_HEADING_RE = /^## Release notes[ \t]*$/m;

/** Where generated content starts below the notes heading. */
const GENERATED_STARTS = [
  "<!-- onegai:section ",
  "_No user-facing changes._",
  "### Contributors",
  "<details>",
];

/**
 * The introduction a person wrote under "## Release notes", above the generated sections.
 * Regeneration keeps it verbatim, and the published release includes it.
 */
export function extractIntro(body: string): string {
  const text = body.replace(/\r\n/g, "\n");
  const heading = NOTES_HEADING_RE.exec(text);
  if (!heading) return "";
  const after = text.slice(heading.index + heading[0].length);
  const ends = GENERATED_STARTS.map((marker) => after.indexOf(marker)).filter((i) => i >= 0);
  return after.slice(0, ends.length > 0 ? Math.min(...ends) : after.length).trim();
}
