#!/usr/bin/env node
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_version = require("./version-xneg5MKd.cjs");
let node_fs = require("node:fs");
let node_path = require("node:path");
// src/ledger/files.ts
/** Read and validate every entry file in a directory, sorted by PR number. */
function readEntryDir(dir) {
	let names;
	try {
		names = (0, node_fs.readdirSync)(dir);
	} catch {
		return [];
	}
	const entries = [];
	for (const name of names) {
		if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
		const content = (0, node_fs.readFileSync)((0, node_path.join)(dir, name), "utf8");
		entries.push(require_version.entryFromYaml(content));
	}
	return entries.sort((a, b) => a.pr - b.pr);
}
// src/cli.ts
function loadEntries(options) {
	if (options.dir) return readEntryDir(options.dir);
	if (options.body) return require_version.parseSnapshot((0, node_fs.readFileSync)(options.body, "utf8"));
	return [];
}
/** Dry-run report: entries, proposed version, rendered notes. Writes nothing. */
function preview(options) {
	const entries = loadEntries(options);
	const bump = require_version.computeBump(entries, options.current, { capBreakingBeforeMajor1: options.capBreakingBeforeMajor1 });
	const lines = [];
	lines.push(`Entries (${entries.length}):`);
	if (entries.length === 0) lines.push("  (none)");
	else for (const e of entries) lines.push(`  #${e.pr} ${e.kind} (${e.confidence}) — ${e.summary}`);
	lines.push("");
	lines.push(bump.level === "none" && !bump.forced ? `Proposed version: ${bump.current} (no release-worthy changes)` : `Proposed version: ${bump.current} -> ${bump.next} (${bump.forced ? "forced" : bump.level})`);
	if (bump.warnings.length > 0) {
		lines.push("");
		lines.push("Warnings:");
		for (const w of bump.warnings) lines.push(`  - #${w.pr}: ${w.type}`);
	}
	lines.push("");
	lines.push("Release notes:");
	lines.push("");
	lines.push(require_version.renderReleaseNotesPlain(entries));
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
function getFlag(argv, name) {
	const i = argv.indexOf(name);
	return i !== -1 ? argv[i + 1] : void 0;
}
/** CLI entry point. Returns a process exit code. */
async function main(argv) {
	const command = argv[0];
	if (command !== "preview") {
		process.stdout.write(USAGE);
		return command === void 0 || command === "--help" || command === "-h" ? 0 : 1;
	}
	const options = {
		dir: getFlag(argv, "--dir"),
		body: getFlag(argv, "--body"),
		current: getFlag(argv, "--current") ?? "0.0.0",
		capBreakingBeforeMajor1: argv.includes("--pre-1.0")
	};
	if (!options.dir && !options.body) {
		process.stderr.write("error: provide --dir or --body\n\n");
		process.stdout.write(USAGE);
		return 1;
	}
	process.stdout.write(`${preview(options)}\n`);
	return 0;
}
if (/cli\.c?js$/.test(process.argv[1] ?? "")) main(process.argv.slice(2)).then((code) => {
	process.exitCode = code;
});
exports.main = main;
exports.preview = preview;
