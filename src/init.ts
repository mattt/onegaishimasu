import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const CONFIG_PATH = ".github/onegai.yml";
const WORKFLOW_PATH = ".github/workflows/onegai.yml";
const SETUP_BRANCH = "onegai/setup";
const SECRET_NAME = "ONEGAI_PROVIDER_API_KEY";

export interface InitOptions {
  provider?: string;
  model?: string;
  publishWorkflow?: string;
  tagInput?: string;
  dryRun?: boolean;
  noPr?: boolean;
  force?: boolean;
}

export interface InitProvider {
  type: "anthropic" | "openai" | "copilot";
  model: string;
}

export interface Repository {
  nameWithOwner: string;
  defaultBranch: string;
}

export interface WorkflowFile {
  name: string;
  content: string;
}

export interface PublishWorkflow {
  workflow: string;
  tagInput: string;
}

export type InitStep =
  | { kind: "write"; path: string; content: string }
  | {
      kind: "command";
      command: "git" | "gh";
      args: string[];
      role?: "clean" | "permissions" | "secret" | "pr";
    };

/** Input is sent through stdin, never through command arguments or a shell. */
export type InitRunner = (
  command: string,
  args: string[],
  options: { cwd: string; input?: string },
) => Promise<string>;

export interface InitDependencies {
  cwd?: string;
  runner?: InitRunner;
  env?: NodeJS.ProcessEnv;
  readSecret?: () => Promise<string>;
  write?: (text: string) => void;
}

export function parseInitArgs(args: string[]): InitOptions {
  const { values } = parseArgs({
    args,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      "publish-workflow": { type: "string" },
      "tag-input": { type: "string" },
      "dry-run": { type: "boolean" },
      "no-pr": { type: "boolean" },
      force: { type: "boolean" },
    },
  });
  return {
    provider: values.provider,
    model: values.model,
    publishWorkflow: values["publish-workflow"],
    tagInput: values["tag-input"],
    dryRun: values["dry-run"],
    noPr: values["no-pr"],
    force: values.force,
  };
}

export function initProvider(options: InitOptions): InitProvider {
  const type = options.provider ?? "anthropic";
  if (type !== "anthropic" && type !== "openai" && type !== "copilot") {
    throw new Error("--provider must be anthropic, openai, or copilot.");
  }
  const model = options.model ?? (type === "anthropic" ? "claude-opus-5-5" : "auto");
  if ((type === "openai" && options.model === undefined) || !model.trim()) {
    throw new Error("Provide --model with a nonempty model name for this provider.");
  }
  return { type, model };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Only dispatchable workflows with the selected input can publish a tag. */
export function detectPublishWorkflow(
  files: WorkflowFile[],
  options: Pick<InitOptions, "publishWorkflow" | "tagInput"> = {},
): PublishWorkflow | undefined {
  const selected = options.publishWorkflow?.replace(/^\.github\/workflows\//, "");
  const tagInput = options.tagInput ?? "tag";
  if (!tagInput.trim()) throw new Error("--tag-input must not be empty.");
  const candidates = files
    .filter((file) => file.name !== "onegai.yml" && /\.ya?ml$/.test(file.name))
    .filter((file) => selected === undefined || file.name === selected)
    .filter((file) => {
      let workflow: unknown;
      try {
        workflow = parseYaml(file.content);
      } catch {
        return false;
      }
      if (!isRecord(workflow) || !isRecord(workflow.on)) return false;
      const dispatch = workflow.on.workflow_dispatch;
      return (
        isRecord(dispatch) && isRecord(dispatch.inputs) && Object.hasOwn(dispatch.inputs, tagInput)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  if (candidates.length > 1) {
    throw new Error(
      `Several publish workflows accept ${tagInput}: ${candidates.map((file) => file.name).join(", ")}. Choose one with --publish-workflow <file>.`,
    );
  }
  const candidate = candidates[0];
  if (!candidate && (selected !== undefined || options.tagInput !== undefined)) {
    throw new Error(
      `No publish workflow${selected === undefined ? "" : ` named ${selected}`} has a workflow_dispatch input named ${tagInput}.`,
    );
  }
  return candidate ? { workflow: candidate.name, tagInput } : undefined;
}

export function renderInitConfig(provider: InitProvider, publish?: PublishWorkflow): string {
  return stringifyYaml({ provider, ...(publish ? { publish } : {}) });
}

export function renderInitWorkflow(
  defaultBranch: string,
  provider: InitProvider,
  publish?: PublishWorkflow,
): string {
  const providerStep =
    provider.type === "copilot"
      ? `      - run: npm install -g @github/copilot
      - uses: mattt/onegaishimasu@v0
        env:
          GITHUB_TOKEN: \${{ github.token }}
`
      : `      - uses: mattt/onegaishimasu@v0
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
export function planInit(
  repository: Repository,
  options: InitOptions,
  workflows: WorkflowFile[],
): InitStep[] {
  const provider = initProvider(options);
  const publish = detectPublishWorkflow(workflows, options);
  const steps: InitStep[] = [
    { kind: "command", command: "git", args: ["status", "--porcelain"], role: "clean" },
    { kind: "command", command: "git", args: ["switch", "-c", SETUP_BRANCH] },
    { kind: "write", path: CONFIG_PATH, content: renderInitConfig(provider, publish) },
    {
      kind: "write",
      path: WORKFLOW_PATH,
      content: renderInitWorkflow(repository.defaultBranch, provider, publish),
    },
    { kind: "command", command: "git", args: ["add", "--", CONFIG_PATH, WORKFLOW_PATH] },
    { kind: "command", command: "git", args: ["commit", "-m", "Set up Onegaishimasu"] },
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
        "default_workflow_permissions=write",
        "-F",
        "can_approve_pull_request_reviews=true",
      ],
      role: "permissions",
    });
    if (provider.type !== "copilot") {
      steps.push({
        kind: "command",
        command: "gh",
        args: ["secret", "set", SECRET_NAME, "--repo", repository.nameWithOwner],
        role: "secret",
      });
    }
    steps.push(
      {
        kind: "command",
        command: "git",
        args: ["push", "--set-upstream", "origin", SETUP_BRANCH],
      },
      {
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
          "Set up Onegaishimasu to maintain a release pull request.",
        ],
        role: "pr",
      },
    );
  }
  return steps;
}

export function permissionsHelp(repository: Repository, status: "403" | "409"): string {
  const owner = repository.nameWithOwner.split("/")[0];
  return `GitHub blocked the workflow permission change (HTTP ${status}).
At https://github.com/${repository.nameWithOwner}/settings/actions, under Workflow permissions, select "Read and write permissions", enable "Allow GitHub Actions to create and approve pull requests", and save.
If organization policy locks these settings, ask an organization owner to allow both at https://github.com/organizations/${owner}/settings/actions under Workflow permissions. If enterprise policy locks them, an enterprise owner must allow them first.
`;
}

const defaultRunner: InitRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
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
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
    // A process can close stdin before all input is written. Report its exit error instead.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });

function readSecretFromStdin(): Promise<string> {
  if (process.stdin.isTTY) process.stderr.write("Provider API key (hidden): ");
  // A terminal readline interface disables echo through this silent output stream.
  const silent = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const reader = createInterface({
    input: process.stdin,
    output: silent,
    terminal: Boolean(process.stdin.isTTY),
  });
  return new Promise((resolve, reject) => {
    reader.once("close", () =>
      reject(new Error(`Provide ${SECRET_NAME} through the environment or stdin.`)),
    );
    reader.once("SIGINT", () => reader.close());
    reader.question("", (answer) => {
      resolve(answer);
      reader.close();
      if (process.stdin.isTTY) process.stderr.write("\n");
    });
  });
}

function shellWord(value: string): string {
  return /^[\w./=@:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function commandText(command: string, args: string[]): string {
  return [command, ...args].map(shellWord).join(" ");
}

function readWorkflows(root: string): WorkflowFile[] {
  const directory = join(root, ".github/workflows");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((file) => file.isFile() && /\.ya?ml$/.test(file.name) && file.name !== "onegai.yml")
    .map((file) => ({
      name: file.name,
      content: readFileSync(join(directory, file.name), "utf8"),
    }));
}

/** Discover with read-only commands, then execute or print the complete setup plan. */
export async function init(
  options: InitOptions,
  dependencies: InitDependencies = {},
): Promise<void> {
  const provider = initProvider(options);
  const runner = dependencies.runner ?? defaultRunner;
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text));
  const cwd = dependencies.cwd ?? process.cwd();
  const discover = async (command: string, args: string[], directory: string) => {
    if (options.dryRun) write(`$ ${commandText(command, args)}\n`);
    return runner(command, args, { cwd: directory });
  };
  const root = (await discover("git", ["rev-parse", "--show-toplevel"], cwd)).trim();
  if (!root) throw new Error("Run onegai init inside a git repository.");
  for (const path of [CONFIG_PATH, WORKFLOW_PATH]) {
    if (!options.force && existsSync(join(root, path))) {
      throw new Error(`Refusing to overwrite ${path}. Use --force to replace it.`);
    }
  }
  const details: unknown = JSON.parse(
    await discover("gh", ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], root),
  );
  if (
    !isRecord(details) ||
    typeof details.nameWithOwner !== "string" ||
    !/^[^/\s]+\/[^/\s]+$/.test(details.nameWithOwner) ||
    !isRecord(details.defaultBranchRef) ||
    typeof details.defaultBranchRef.name !== "string" ||
    !details.defaultBranchRef.name
  ) {
    throw new Error("GitHub did not return a repository and default branch. Check gh auth status.");
  }
  const repository = {
    nameWithOwner: details.nameWithOwner,
    defaultBranch: details.defaultBranchRef.name,
  };
  const steps = planInit(repository, options, readWorkflows(root));
  let key: string | undefined;
  let prUrl = "";
  let permissionsBlocked = false;
  for (const step of steps) {
    if (options.dryRun) {
      write(
        step.kind === "write"
          ? `\nWrite ${step.path}:\n${step.content}\n`
          : `$ ${commandText(step.command, step.args)}${step.role === "secret" ? " # API key through stdin (hidden)" : ""}\n`,
      );
      continue;
    }
    if (step.kind === "write") {
      const path = join(root, step.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, step.content, { flag: options.force ? "w" : "wx" });
      continue;
    }
    let output: string;
    try {
      output = await runner(step.command, step.args, {
        cwd: root,
        ...(step.role === "secret" ? { input: key } : {}),
      });
    } catch (error) {
      if (step.role === "secret") {
        throw new Error(
          `Could not set ${SECRET_NAME}. Check gh authentication and secret write access, then rerun gh secret set ${SECRET_NAME}.`,
        );
      }
      const status =
        error instanceof Error ? /\bHTTP\s+(403|409)\b/i.exec(error.message)?.[1] : undefined;
      if (step.role !== "permissions" || (status !== "403" && status !== "409")) throw error;
      permissionsBlocked = true;
      write(permissionsHelp(repository, status));
      continue;
    }
    if (step.role === "clean") {
      if (output.trim())
        throw new Error("Commit or stash your changes before running onegai init.");
      // Read the key before making changes, but never read it during a dry run or --no-pr.
      if (!options.noPr && provider.type !== "copilot") {
        key = (dependencies.env ?? process.env)[SECRET_NAME]?.trim();
        if (!key) key = (await (dependencies.readSecret ?? readSecretFromStdin)()).trim();
        if (!key)
          throw new Error(`Provide a nonempty ${SECRET_NAME} through the environment or stdin.`);
      }
    }
    if (step.role === "pr") prUrl = output.trim();
  }
  if (options.dryRun) {
    write(
      "\nDry run complete. No files, settings, secrets, branches, or pull requests were changed.\n",
    );
  } else if (options.noPr) {
    write(`Committed ${CONFIG_PATH} and ${WORKFLOW_PATH} on ${SETUP_BRANCH}.\n`);
    write(
      `Next: enable workflow PR permissions${provider.type === "copilot" ? "" : `, set ${SECRET_NAME}`}, push the branch, open a pull request, and merge it.\n`,
    );
  } else {
    write(`Set up Onegaishimasu on ${SETUP_BRANCH}. Pull request: ${prUrl}\n`);
    write(
      `Next: ${permissionsBlocked ? "complete the permission changes above, then " : ""}merge the setup pull request.\n`,
    );
  }
}
