#!/usr/bin/env node
import { readFileSync } from "node:fs";
import type { Entry } from "./entry.js";
import { readEntryDir } from "./ledger/files.js";
import { parseSnapshot } from "./ledger/snapshot.js";
import { renderReleaseNotesPlain } from "./render/release-body.js";
import { computeBump } from "./version.js";

export interface PreviewOptions {
  /** Directory of entry files (the self-serve interface). */
  dir?: string;
  /** A saved release PR body to parse the ledger snapshot from. */
  body?: string;
  current: string;
  capBreakingBeforeMajor1?: boolean;
}

function loadEntries(options: PreviewOptions): Entry[] {
  if (options.dir) return readEntryDir(options.dir);
  if (options.body) return parseSnapshot(readFileSync(options.body, "utf8"));
  return [];
}

/** Dry-run report: entries, proposed version, rendered notes. Writes nothing. */
export function preview(options: PreviewOptions): string {
  const entries = loadEntries(options);
  const bump = computeBump(entries, options.current, {
    capBreakingBeforeMajor1: options.capBreakingBeforeMajor1,
  });

  const lines: string[] = [];
  lines.push(`Entries (${entries.length}):`);
  if (entries.length === 0) {
    lines.push("  (none)");
  } else {
    for (const e of entries) {
      lines.push(`  #${e.pr} ${e.kind} (${e.confidence}) — ${e.summary}`);
    }
  }
  lines.push("");
  lines.push(
    bump.level === "none" && !bump.forced
      ? `Proposed version: ${bump.current} (no release-worthy changes)`
      : `Proposed version: ${bump.current} -> ${bump.next} (${bump.forced ? "forced" : bump.level})`,
  );
  if (bump.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of bump.warnings) lines.push(`  - #${w.pr}: ${w.type}`);
  }
  lines.push("");
  lines.push("Release notes:");
  lines.push("");
  lines.push(renderReleaseNotesPlain(entries));

  return lines.join("\n");
}

const USAGE = `onegai — preview a release from the ledger, writing nothing.

Usage:
  onegai preview --dir <entries-dir> [--current <version>] [--pre-1.0]
  onegai preview --body <release-pr-body-file> [--current <version>] [--pre-1.0]

Options:
  --dir <path>      Read entries from a directory of entry files.
  --body <path>     Read the ledger snapshot from a saved release PR body.
  --current <ver>   Current version (default 0.0.0).
  --pre-1.0         Cap breaking changes at a minor bump before 1.0.0.
`;

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

/** CLI entry point. Returns a process exit code. */
export async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (command !== "preview") {
    process.stdout.write(USAGE);
    return command === undefined || command === "--help" || command === "-h" ? 0 : 1;
  }

  const options: PreviewOptions = {
    dir: getFlag(argv, "--dir"),
    body: getFlag(argv, "--body"),
    current: getFlag(argv, "--current") ?? "0.0.0",
    capBreakingBeforeMajor1: argv.includes("--pre-1.0"),
  };

  if (!options.dir && !options.body) {
    process.stderr.write("error: provide --dir or --body\n\n");
    process.stdout.write(USAGE);
    return 1;
  }

  process.stdout.write(`${preview(options)}\n`);
  return 0;
}

if (/cli\.c?js$/.test(process.argv[1] ?? "")) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
