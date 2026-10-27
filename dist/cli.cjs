#!/usr/bin/env node
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_version = require("./version-BoaCRO5U.cjs");
let node_stream = require("node:stream");
let node_util = require("node:util");
let node_fs = require("node:fs");
let node_child_process = require("node:child_process");
let node_path = require("node:path");
let node_readline = require("node:readline");
// src/init.ts
var import_dist = require_version.require_dist();
const CONFIG_PATH = ".github/onegai.yml";
const WORKFLOW_PATH = ".github/workflows/onegai.yml";
const SETUP_BRANCH = "onegai/setup";
const SECRET_NAME = "ONEGAI_PROVIDER_API_KEY";
function parseInitArgs(args) {
	const { values } = (0, node_util.parseArgs)({
		args,
		options: {
			provider: { type: "string" },
			model: { type: "string" },
			"publish-workflow": { type: "string" },
			"tag-input": { type: "string" },
			"dry-run": { type: "boolean" },
			"no-pr": { type: "boolean" },
			force: { type: "boolean" }
		}
	});
	return {
		provider: values.provider,
		model: values.model,
		publishWorkflow: values["publish-workflow"],
		tagInput: values["tag-input"],
		dryRun: values["dry-run"],
		noPr: values["no-pr"],
		force: values.force
	};
}
function initProvider(options) {
	const type = options.provider ?? "anthropic";
	if (type !== "anthropic" && type !== "openai" && type !== "copilot") throw new Error("--provider must be anthropic, openai, or copilot.");
	const model = options.model ?? (type === "anthropic" ? "claude-opus-5-5" : "auto");
	if (type === "openai" && options.model === void 0 || !model.trim()) throw new Error("Provide --model with a nonempty model name for this provider.");
	return {
		type,
		model
	};
}
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Only dispatchable workflows with the selected input can publish a tag. */
function detectPublishWorkflow(files, options = {}) {
	const selected = options.publishWorkflow?.replace(/^\.github\/workflows\//, "");
	const tagInput = options.tagInput ?? "tag";
	if (!tagInput.trim()) throw new Error("--tag-input must not be empty.");
	const candidates = files.filter((file) => file.name !== "onegai.yml" && /\.ya?ml$/.test(file.name)).filter((file) => selected === void 0 || file.name === selected).filter((file) => {
		let workflow;
		try {
			workflow = (0, import_dist.parse)(file.content);
		} catch {
			return false;
		}
		if (!isRecord(workflow) || !isRecord(workflow.on)) return false;
		const dispatch = workflow.on.workflow_dispatch;
		return isRecord(dispatch) && isRecord(dispatch.inputs) && Object.hasOwn(dispatch.inputs, tagInput);
	}).sort((a, b) => a.name.localeCompare(b.name));
	if (candidates.length > 1) throw new Error(`Several publish workflows accept ${tagInput}: ${candidates.map((file) => file.name).join(", ")}. Choose one with --publish-workflow <file>.`);
	const candidate = candidates[0];
	if (!candidate && (selected !== void 0 || options.tagInput !== void 0)) throw new Error(`No publish workflow${selected === void 0 ? "" : ` named ${selected}`} has a workflow_dispatch input named ${tagInput}.`);
	return candidate ? {
		workflow: candidate.name,
		tagInput
	} : void 0;
}
function renderInitConfig(provider, publish) {
	return (0, import_dist.stringify)({
		provider,
		...publish ? { publish } : {}
	});
}
function renderInitWorkflow(defaultBranch, provider, publish) {
	const providerStep = provider.type === "copilot" ? `      - run: npm install -g @github/copilot
      - uses: mattt/onegaishimasu@v0
        env:
          GITHUB_TOKEN: \${{ github.token }}
` : `      - uses: mattt/onegaishimasu@v0
        with:
          provider-api-key: \${{ secrets.ONEGAI_PROVIDER_API_KEY }}
`;
	return `name: Onegaishimasu

on:
  pull_request:
    types: [closed]
  issue_comment:
    types: [created]
  push:
    branches: [${JSON.stringify(defaultBranch)}]
  workflow_dispatch:

concurrency:
  group: onegai-\${{ github.repository }}
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write
  issues: write
${publish ? "  actions: write\n" : ""}${provider.type === "copilot" ? "  copilot-requests: write\n" : ""}
jobs:
  onegai:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
${providerStep}`;
}
/** The plan contains no credentials and does not perform any IO. */
function planInit(repository, options, workflows) {
	const provider = initProvider(options);
	const publish = detectPublishWorkflow(workflows, options);
	const steps = [
		{
			kind: "command",
			command: "git",
			args: ["status", "--porcelain"],
			role: "clean"
		},
		{
			kind: "command",
			command: "git",
			args: [
				"fetch",
				"origin",
				repository.defaultBranch
			]
		},
		{
			kind: "command",
			command: "git",
			args: [
				"switch",
				"-c",
				SETUP_BRANCH,
				`origin/${repository.defaultBranch}`
			]
		},
		{
			kind: "write",
			path: CONFIG_PATH,
			content: renderInitConfig(provider, publish)
		},
		{
			kind: "write",
			path: WORKFLOW_PATH,
			content: renderInitWorkflow(repository.defaultBranch, provider, publish)
		},
		{
			kind: "command",
			command: "git",
			args: [
				"add",
				"--",
				CONFIG_PATH,
				WORKFLOW_PATH
			]
		},
		{
			kind: "command",
			command: "git",
			args: [
				"commit",
				"-m",
				"Set up Onegaishimasu"
			]
		}
	];
	if (!options.noPr) {
		steps.push({
			kind: "command",
			command: "gh",
			args: [
				"api",
				"-X",
				"PUT",
				`repos/${repository.nameWithOwner}/actions/permissions/workflow`,
				"-F",
				"can_approve_pull_request_reviews=true"
			],
			role: "permissions"
		});
		if (provider.type !== "copilot") steps.push({
			kind: "command",
			command: "gh",
			args: [
				"secret",
				"set",
				SECRET_NAME,
				"--repo",
				repository.nameWithOwner
			],
			role: "secret"
		});
		steps.push({
			kind: "command",
			command: "git",
			args: [
				"push",
				"--set-upstream",
				"origin",
				SETUP_BRANCH
			]
		}, {
			kind: "command",
			command: "gh",
			args: [
				"pr",
				"create",
				"--repo",
				repository.nameWithOwner,
				"--base",
				repository.defaultBranch,
				"--head",
				SETUP_BRANCH,
				"--title",
				"Set up Onegaishimasu",
				"--body",
				"Set up Onegaishimasu to maintain a release pull request."
			],
			role: "pr"
		});
	}
	return steps;
}
function permissionsHelp(repository, status) {
	const owner = repository.nameWithOwner.split("/")[0];
	return `GitHub blocked the workflow permission change (HTTP ${status}).
At https://github.com/${repository.nameWithOwner}/settings/actions, under Workflow permissions, enable "Allow GitHub Actions to create and approve pull requests", and save.
If organization policy locks this setting, ask an organization owner to allow it at https://github.com/organizations/${owner}/settings/actions under Workflow permissions. If enterprise policy locks them, an enterprise owner must allow them first.
`;
}
const defaultRunner = (command, args, options) => new Promise((resolve, reject) => {
	const child = (0, node_child_process.spawn)(command, args, {
		cwd: options.cwd,
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		]
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (data) => {
		stdout += data.toString();
	});
	child.stderr.on("data", (data) => {
		stderr += data.toString();
	});
	child.on("error", reject);
	child.on("close", (code) => {
		if (code === 0) resolve(stdout);
		else reject(/* @__PURE__ */ new Error(`${command} exited ${code}: ${stderr.trim()}`));
	});
	child.stdin.on("error", () => {});
	child.stdin.end(options.input ?? "");
});
function readSecretFromStdin() {
	if (process.stdin.isTTY) process.stderr.write("Provider API key (hidden): ");
	const silent = new node_stream.Writable({ write(_chunk, _encoding, callback) {
		callback();
	} });
	const reader = (0, node_readline.createInterface)({
		input: process.stdin,
		output: silent,
		terminal: Boolean(process.stdin.isTTY)
	});
	return new Promise((resolve, reject) => {
		reader.once("close", () => reject(/* @__PURE__ */ new Error(`Provide ${SECRET_NAME} through the environment or stdin.`)));
		reader.once("SIGINT", () => reader.close());
		reader.question("", (answer) => {
			resolve(answer);
			reader.close();
			if (process.stdin.isTTY) process.stderr.write("\n");
		});
	});
}
function shellWord(value) {
	return /^[\w./=@:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
function commandText(command, args) {
	return [command, ...args].map(shellWord).join(" ");
}
function readWorkflows(root) {
	const directory = (0, node_path.join)(root, ".github/workflows");
	if (!(0, node_fs.existsSync)(directory)) return [];
	return (0, node_fs.readdirSync)(directory, { withFileTypes: true }).filter((file) => file.isFile() && /\.ya?ml$/.test(file.name) && file.name !== "onegai.yml").map((file) => ({
		name: file.name,
		content: (0, node_fs.readFileSync)((0, node_path.join)(directory, file.name), "utf8")
	}));
}
/** Discover with read-only commands, then execute or print the complete setup plan. */
async function init(options, dependencies = {}) {
	const provider = initProvider(options);
	const runner = dependencies.runner ?? defaultRunner;
	const write = dependencies.write ?? ((text) => process.stdout.write(text));
	const cwd = dependencies.cwd ?? process.cwd();
	const discover = async (command, args, directory) => {
		if (options.dryRun) write(`$ ${commandText(command, args)}\n`);
		return runner(command, args, { cwd: directory });
	};
	const root = (await discover("git", ["rev-parse", "--show-toplevel"], cwd)).trim();
	if (!root) throw new Error("Run onegai init inside a git repository.");
	for (const path of [CONFIG_PATH, WORKFLOW_PATH]) if (!options.force && (0, node_fs.existsSync)((0, node_path.join)(root, path))) throw new Error(`Refusing to overwrite ${path}. Use --force to replace it.`);
	const details = JSON.parse(await discover("gh", [
		"repo",
		"view",
		"--json",
		"nameWithOwner,defaultBranchRef"
	], root));
	if (!isRecord(details) || typeof details.nameWithOwner !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(details.nameWithOwner) || !isRecord(details.defaultBranchRef) || typeof details.defaultBranchRef.name !== "string" || !details.defaultBranchRef.name) throw new Error("GitHub did not return a repository and default branch. Check gh auth status.");
	const repository = {
		nameWithOwner: details.nameWithOwner,
		defaultBranch: details.defaultBranchRef.name
	};
	const steps = planInit(repository, options, readWorkflows(root));
	let key;
	let prUrl = "";
	let permissionsBlocked = false;
	for (const step of steps) {
		if (options.dryRun) {
			write(step.kind === "write" ? `\nWrite ${step.path}:\n${step.content}\n` : `$ ${commandText(step.command, step.args)}${step.role === "secret" ? " # API key through stdin (hidden)" : ""}\n`);
			continue;
		}
		if (step.kind === "write") {
			const path = (0, node_path.join)(root, step.path);
			(0, node_fs.mkdirSync)((0, node_path.dirname)(path), { recursive: true });
			(0, node_fs.writeFileSync)(path, step.content, { flag: options.force ? "w" : "wx" });
			continue;
		}
		let output;
		try {
			output = await runner(step.command, step.args, {
				cwd: root,
				...step.role === "secret" ? { input: key } : {}
			});
		} catch (error) {
			if (step.role === "secret") throw new Error(`Could not set ${SECRET_NAME}. Check gh authentication and secret write access, then rerun gh secret set ${SECRET_NAME}.`);
			const status = error instanceof Error ? /\bHTTP\s+(403|409)\b/i.exec(error.message)?.[1] : void 0;
			if (step.role !== "permissions" || status !== "403" && status !== "409") throw error;
			permissionsBlocked = true;
			write(permissionsHelp(repository, status));
			continue;
		}
		if (step.role === "clean") {
			if (output.trim()) throw new Error("Commit or stash your changes before running onegai init.");
			if (!options.noPr && provider.type !== "copilot") {
				key = (dependencies.env ?? process.env)[SECRET_NAME]?.trim();
				if (!key) key = (await (dependencies.readSecret ?? readSecretFromStdin)()).trim();
				if (!key) throw new Error(`Provide a nonempty ${SECRET_NAME} through the environment or stdin.`);
			}
		}
		if (step.role === "pr") prUrl = output.trim();
	}
	if (options.dryRun) write("\nDry run complete. No files, settings, secrets, branches, or pull requests were changed.\n");
	else if (options.noPr) {
		write(`Committed ${CONFIG_PATH} and ${WORKFLOW_PATH} on ${SETUP_BRANCH}.\n`);
		write(`Next: enable workflow PR permissions${provider.type === "copilot" ? "" : `, set ${SECRET_NAME}`}, push the branch, open a pull request, and merge it.\n`);
	} else {
		write(`Set up Onegaishimasu on ${SETUP_BRANCH}. Pull request: ${prUrl}\n`);
		write(`Next: ${permissionsBlocked ? "complete the permission changes above, then " : ""}merge the setup pull request.\n`);
	}
}
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
function getFlag(argv, name) {
	const i = argv.indexOf(name);
	return i !== -1 ? argv[i + 1] : void 0;
}
/** CLI entry point. Returns a process exit code. */
async function main(argv, initDependencies) {
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
