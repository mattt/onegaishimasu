import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { type Entry, entrySchema } from "../entry.js";

/**
 * GitHub caps issue and PR bodies at 65536 characters.
 * Staying under it leaves headroom for surrounding prose and an oversize entry.
 */
export const DEFAULT_MAX_CHUNK = 60000;

const START = (part: number, total: number): string =>
  `<!-- onegai:ledger:start part=${part}/${total} -->`;
const END = "<!-- onegai:ledger:end -->";

/** Matches one snapshot chunk and captures its part index and fenced YAML. */
const CHUNK_RE =
  /<!-- onegai:ledger:start part=(\d+)\/(\d+) -->\s*```yaml\n([\s\S]*?)\n```\s*<!-- onegai:ledger:end -->/g;

function wrapChunk(yaml: string, part: number, total: number): string {
  return `${START(part, total)}\n\`\`\`yaml\n${yaml}\n\`\`\`\n${END}`;
}

/**
 * Serialize entries into self-contained ledger chunks.
 * The first chunk belongs in the release PR body; overflow spills into bot comments.
 * Each chunk carries its part index so order survives reassembly.
 */
export function serializeSnapshot(entries: Entry[], maxChunkSize = DEFAULT_MAX_CHUNK): string[] {
  const validated = entries.map((e) => entrySchema.parse(e));

  // Pre-serialize each entry as a single-item YAML list element.
  const serialized = validated.map((e) => stringifyYaml([e]).trimEnd());

  if (serialized.length === 0) {
    return [wrapChunk(stringifyYaml([]).trimEnd(), 1, 1)];
  }

  // Pack greedily, reserving the wrapper's fixed overhead.
  const overhead = wrapChunk("", 9, 9).length + 16;
  const budget = Math.max(maxChunkSize - overhead, 1);

  const groups: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const item of serialized) {
    const addition = item.length + 1;
    if (current.length > 0 && currentLen + addition > budget) {
      groups.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(item);
    currentLen += addition;
  }
  if (current.length > 0) groups.push(current);

  const total = groups.length;
  return groups.map((group, i) => wrapChunk(group.join("\n"), i + 1, total));
}

/**
 * Reassemble entries from a release PR body and its bot comments.
 * Chunks are found wherever they appear, ordered by part index, and concatenated.
 * Non-chunk text is ignored, so parsing never depends on how GitHub renders the body.
 */
export function parseSnapshot(body: string, comments: string[] = []): Entry[] {
  // Bodies saved from GitHub's web editor use CRLF line endings.
  const sources = [body, ...comments].map((s) => s.replace(/\r\n/g, "\n"));
  const found: { part: number; yaml: string }[] = [];

  for (const source of sources) {
    for (const match of source.matchAll(CHUNK_RE)) {
      const part = Number(match[1]);
      const yaml = match[3] ?? "";
      found.push({ part, yaml });
    }
  }

  found.sort((a, b) => a.part - b.part);

  const entries: Entry[] = [];
  for (const { yaml } of found) {
    const parsed = parseYaml(yaml);
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      entries.push(entrySchema.parse(item));
    }
  }
  return entries;
}

/** True when the text contains at least one ledger chunk. */
export function hasSnapshot(text: string): boolean {
  return new RegExp(CHUNK_RE.source).test(text);
}
