#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import type { Entry } from "./entry.js";
import { init, parseInitArgs, type InitDependencies } from "./init.js";
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

const USAGE = `onegai — set up Onegaishimasu or preview a release.

Usage:
  onegai init [--provider anthropic|openai|copilot] [--model <name>]
              [--publish-workflow <file>] [--tag-input <name>]
              [--dry-run] [--no-pr] [--force]
  onegai preview --dir <entries-dir> [--current <version>] [--pre-1.0]
  onegai preview --body <release-pr-body-file> [--current <version>] [--pre-1.0]

Init options:
  --provider <name>          Provider (default anthropic).
  --model <name>             Default claude-opus-5-5 for anthropic, auto for copilot;
                            required for openai.
  --publish-workflow <file>  Publish workflow in .github/workflows (auto-detected).
  --tag-input <name>         Dispatch input for the release tag (default tag).
  --dry-run                 Print files and commands without making changes.
  --no-pr                   Write and commit locally; skip remote changes.
  --force                   Replace existing Onegaishimasu files.

Init uses your gh login. Provide ONEGAI_PROVIDER_API_KEY through the environment
or stdin (not needed for copilot, --dry-run, or --no-pr).

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
export async function main(argv: string[], initDependencies?: InitDependencies): Promise<number> {
  const command = argv[0];
  if (command === "init") {
    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write(USAGE);
      return 0;
    }
    try {
      await init(parseInitArgs(argv.slice(1)), initDependencies);
      return 0;
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
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

/** The script path, through symlinks such as `node_modules/.bin/onegai`, as `npx` runs it. */
export function scriptPath(argv1: string | undefined): string {
  if (!argv1) return "";
  try {
    return realpathSync(argv1);
  } catch {
    return argv1;
  }
}

if (/cli\.c?js$/.test(scriptPath(process.argv[1]))) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
