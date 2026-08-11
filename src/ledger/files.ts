import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Entry, entryFromYaml, entryToYaml } from "../entry.js";

/**
 * The self-serve persistence interface: a directory of entry files, one per PR.
 * Where the directory durably lives is the consumer's problem.
 */

function entryFileName(pr: number): string {
  return `${pr}.yml`;
}

/** Write a single entry to `<dir>/<pr>.yml`, creating the directory if needed. */
export function writeEntryFile(dir: string, entry: Entry): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, entryFileName(entry.pr));
  writeFileSync(path, entryToYaml(entry), "utf8");
  return path;
}

/** Read and validate every entry file in a directory, sorted by PR number. */
export function readEntryDir(dir: string): Entry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const entries: Entry[] = [];
  for (const name of names) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const content = readFileSync(join(dir, name), "utf8");
    entries.push(entryFromYaml(content));
  }
  return entries.sort((a, b) => a.pr - b.pr);
}
