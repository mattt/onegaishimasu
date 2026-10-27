import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { parse as parseYaml } from "yaml";
import { main } from "../src/cli.js";
import {
  detectPublishWorkflow,
  init,
  initProvider,
  parseInitArgs,
  permissionsHelp,
  planInit,
  renderInitConfig,
  renderInitWorkflow,
  type InitRunner,
} from "../src/init.js";

const repository = { nameWithOwner: "example/project", defaultBranch: "trunk" };
const publish = { workflow: "release.yml", tagInput: "tag" };
const dispatch = (input = "tag") =>
  `on:\n  workflow_dispatch:\n    inputs:\n      ${input}:\n        required: true\n        type: string\n`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function harness() {
  const root = mkdtempSync(join(tmpdir(), "onegai-init-"));
  roots.push(root);
  const calls: { command: string; args: string[]; cwd: string; input?: string }[] = [];
  const output: string[] = [];
  const runner: InitRunner = vi.fn(async (command, args, options) => {
    calls.push({ command, args, ...options });
    if (command === "git" && args[0] === "rev-parse") return root;
    if (command === "gh" && args[0] === "repo") {
      return JSON.stringify({
        nameWithOwner: repository.nameWithOwner,
        defaultBranchRef: { name: repository.defaultBranch },
      });
    }
    if (command === "gh" && args[0] === "pr") return "https://github.com/example/project/pull/1\n";
    return "";
  });
  const readSecret = vi.fn(async () => "stdin-secret");
  return {
    root,
    calls,
    output,
    dependencies: {
      cwd: root,
      runner,
      env: {},
      readSecret,
      write: (text: string) => output.push(text),
    },
    file(path: string, content: string) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    },
  };
}

describe("init options and rendering", () => {
  it("parses all init flags and rejects unknown or incomplete flags", () => {
    expect(
      parseInitArgs([
        "--provider",
        "openai",
        "--model",
        "test-model",
        "--publish-workflow",
        "release.yml",
        "--tag-input",
        "version",
        "--dry-run",
        "--no-pr",
        "--force",
      ]),
    ).toEqual({
      provider: "openai",
      model: "test-model",
      publishWorkflow: "release.yml",
      tagInput: "version",
      dryRun: true,
      noPr: true,
      force: true,
    });
    expect(() => parseInitArgs(["--model"])).toThrow();
    expect(() => parseInitArgs(["--unknown"])).toThrow();
    expect(() => parseInitArgs(["extra"])).toThrow();
    expect(() => initProvider({ provider: "other" })).toThrow(/--provider/);
    expect(() => initProvider({ provider: "openai" })).toThrow(/--model/);
    expect(() => initProvider({ model: " " })).toThrow(/--model/);
  });

  it("renders the default Anthropic config and the quick start workflow", () => {
    const provider = initProvider({});
    expect(parseYaml(renderInitConfig(provider))).toEqual({
      provider: { type: "anthropic", model: "claude-opus-5-5" },
    });
    const workflow = parseYaml(renderInitWorkflow("trunk", provider));
    expect(workflow.on).toEqual({
      pull_request: { types: ["closed"] },
      issue_comment: { types: ["created"] },
      push: { branches: ["trunk"] },
      workflow_dispatch: null,
    });
    expect(workflow.concurrency).toEqual({
      group: "onegai-${{ github.repository }}",
      "cancel-in-progress": false,
    });
    expect(workflow.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
      issues: "write",
    });
    expect(workflow.jobs.onegai).toEqual({
      "runs-on": "ubuntu-latest",
      steps: [
        { uses: "actions/checkout@v7" },
        {
          uses: "mattt/onegaishimasu@v0",
          with: { "provider-api-key": "${{ secrets.ONEGAI_PROVIDER_API_KEY }}" },
        },
      ],
    });
  });

  it("renders Copilot permissions, install, and token without a secret", () => {
    const provider = initProvider({ provider: "copilot" });
    expect(provider.model).toBe("auto");
    const text = renderInitWorkflow("main", provider, publish);
    const workflow = parseYaml(text);
    expect(workflow.permissions["copilot-requests"]).toBe("write");
    expect(workflow.permissions.actions).toBe("write");
    expect(workflow.jobs.onegai.steps.slice(1)).toEqual([
      { run: "npm install -g @github/copilot" },
      { uses: "mattt/onegaishimasu@v0", env: { GITHUB_TOKEN: "${{ github.token }}" } },
    ]);
    expect(text).not.toContain("provider-api-key");
  });

  it("preserves custom models, branch names, and publish inputs as YAML values", () => {
    const provider = initProvider({ provider: "openai", model: "some: model # name" });
    expect(parseYaml(renderInitConfig(provider, publish))).toEqual({ provider, publish });
    expect(
      parseYaml(renderInitWorkflow("release/#next", provider, publish)).on.push.branches,
    ).toEqual(["release/#next"]);
    expect(parseYaml(renderInitWorkflow("main", provider, publish)).permissions.actions).toBe(
      "write",
    );
  });
});

describe("publish workflow detection", () => {
  it("finds a dispatch input in either YAML extension and ignores its own workflow", () => {
    expect(
      detectPublishWorkflow([
        { name: "onegai.yml", content: dispatch() },
        { name: "ci.yml", content: "on: [push, pull_request]\n" },
        { name: "release.yaml", content: dispatch() },
      ]),
    ).toEqual({ workflow: "release.yaml", tagInput: "tag" });
  });

  it("ignores malformed YAML and inputs under other triggers", () => {
    expect(
      detectPublishWorkflow([
        { name: "bad.yml", content: "on: [broken" },
        { name: "release.yml", content: "on:\n  workflow_call:\n    inputs:\n      tag: {}\n" },
        { name: "manual.yml", content: "on: workflow_dispatch\n" },
      ]),
    ).toBeUndefined();
    expect(detectPublishWorkflow([])).toBeUndefined();
  });

  it("requires a choice when several workflows match", () => {
    const files = [
      { name: "a.yml", content: dispatch() },
      { name: "b.yml", content: dispatch() },
    ];
    expect(() => detectPublishWorkflow(files)).toThrow(/--publish-workflow/);
    expect(detectPublishWorkflow(files, { publishWorkflow: "b.yml" })).toEqual({
      workflow: "b.yml",
      tagInput: "tag",
    });
  });

  it("validates the selected workflow and custom tag input", () => {
    const files = [{ name: "release.yml", content: dispatch("version") }];
    expect(
      detectPublishWorkflow(files, {
        publishWorkflow: ".github/workflows/release.yml",
        tagInput: "version",
      }),
    ).toEqual({ workflow: "release.yml", tagInput: "version" });
    expect(() => detectPublishWorkflow(files, { publishWorkflow: "missing.yml" })).toThrow(
      /No publish workflow/,
    );
    expect(() => detectPublishWorkflow(files, { publishWorkflow: "release.yml" })).toThrow(
      /input named tag/,
    );
    expect(() => detectPublishWorkflow(files, { tagInput: "" })).toThrow(/empty/);
  });
});

describe("init plan and execution", () => {
  it("plans every write and command without storing credentials", () => {
    const steps = planInit(repository, { dryRun: true }, [
      { name: "release.yml", content: dispatch() },
    ]);
    expect(steps.filter((step) => step.kind === "write").map((step) => step.path)).toEqual([
      ".github/onegai.yml",
      ".github/workflows/onegai.yml",
    ]);
    const commands = steps.filter((step) => step.kind === "command");
    expect(commands.map((step) => [step.command, ...step.args.slice(0, 2)])).toEqual([
      ["git", "status", "--porcelain"],
      ["git", "switch", "-c"],
      ["git", "add", "--"],
      ["git", "commit", "-m"],
      ["gh", "api", "-X"],
      ["gh", "secret", "set"],
      ["git", "push", "--set-upstream"],
      ["gh", "pr", "create"],
    ]);
    expect(commands.find((step) => step.role === "permissions")?.args).toEqual([
      "api",
      "-X",
      "PUT",
      "repos/example/project/actions/permissions/workflow",
      "-F",
      "default_workflow_permissions=write",
      "-F",
      "can_approve_pull_request_reviews=true",
    ]);
    expect(commands.find((step) => step.role === "pr")?.args).toContain("trunk");
    expect(JSON.stringify(steps)).not.toContain("stdin-secret");
  });

  it("prints every planned file and command in a dry run and only executes discovery", async () => {
    const h = harness();
    await init({ dryRun: true }, h.dependencies);
    expect(h.calls.map((call) => [call.command, ...call.args])).toEqual([
      ["git", "rev-parse", "--show-toplevel"],
      ["gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
    ]);
    expect(readdirSync(h.root)).toEqual([]);
    expect(h.dependencies.readSecret).not.toHaveBeenCalled();
    const output = h.output.join("");
    for (const step of planInit(repository, {}, [])) {
      if (step.kind === "write") expect(output).toContain(`Write ${step.path}:\n${step.content}`);
      else expect(output).toContain(`$ ${step.command} ${step.args[0]}`);
    }
    expect(output).toContain(
      "gh secret set ONEGAI_PROVIDER_API_KEY --repo example/project # API key through stdin (hidden)",
    );
    expect(output).toContain(
      "No files, settings, secrets, branches, or pull requests were changed",
    );
    expect(output).not.toContain("stdin-secret");
  });

  it("makes only local changes with --no-pr, even without an API key", async () => {
    const h = harness();
    h.file(".github/workflows/release.yml", dispatch());
    await init({ noPr: true }, h.dependencies);
    expect(h.calls.filter((call) => call.command === "gh").map((call) => call.args[0])).toEqual([
      "repo",
    ]);
    expect(h.calls.some((call) => call.args[0] === "push")).toBe(false);
    expect(h.calls.find((call) => call.args[0] === "commit")?.args).toEqual([
      "commit",
      "-m",
      "Set up Onegaishimasu",
    ]);
    expect(h.dependencies.readSecret).not.toHaveBeenCalled();
    expect(parseYaml(readFileSync(join(h.root, ".github/onegai.yml"), "utf8")).publish).toEqual(
      publish,
    );
    expect(h.output.join("")).toContain("push the branch, open a pull request, and merge it");
  });

  it.each([".github/onegai.yml", ".github/workflows/onegai.yml"])(
    "refuses to overwrite %s",
    async (path) => {
      const h = harness();
      h.file(path, "existing content\n");
      await expect(init({}, h.dependencies)).rejects.toThrow(`Refusing to overwrite ${path}`);
      await expect(init({ dryRun: true }, h.dependencies)).rejects.toThrow(/--force/);
      expect(readFileSync(join(h.root, path), "utf8")).toBe("existing content\n");
      expect(h.calls.every((call) => call.args[0] === "rev-parse")).toBe(true);
    },
  );

  it("replaces existing files only with --force", async () => {
    const h = harness();
    h.file(".github/onegai.yml", "existing content\n");
    h.file(".github/workflows/onegai.yml", "existing workflow\n");
    await init({ force: true, noPr: true }, h.dependencies);
    expect(parseYaml(readFileSync(join(h.root, ".github/onegai.yml"), "utf8")).provider.type).toBe(
      "anthropic",
    );
    expect(readFileSync(join(h.root, ".github/workflows/onegai.yml"), "utf8")).toContain(
      "name: Onegaishimasu",
    );
  });

  it.each(["403", "409"])(
    "continues after HTTP %s and explains the required settings",
    async (status) => {
      const h = harness();
      const runner = h.dependencies.runner;
      h.dependencies.runner = async (command, args, options) => {
        if (args[0] === "api") throw new Error(`gh: policy prevents this (HTTP ${status})`);
        return runner(command, args, options);
      };
      await init({}, h.dependencies);
      const output = h.output.join("");
      expect(output).toContain(permissionsHelp(repository, status as "403" | "409"));
      expect(output).toContain("https://github.com/example/project/settings/actions");
      expect(output).toContain("https://github.com/organizations/example/settings/actions");
      expect(output).toContain('"Read and write permissions"');
      expect(output).toContain('"Allow GitHub Actions to create and approve pull requests"');
      expect(output).toContain("complete the permission changes above");
      expect(h.calls.some((call) => call.args[0] === "push")).toBe(true);
      expect(h.calls.some((call) => call.args[0] === "pr")).toBe(true);
    },
  );

  it.each(["environment", "stdin"])("passes a key from %s only through stdin", async (source) => {
    const h = harness();
    const secret = source === "environment" ? "env-secret" : "stdin-secret";
    if (source === "environment") h.dependencies.env = { ONEGAI_PROVIDER_API_KEY: secret };
    await init({}, h.dependencies);
    expect(h.calls.filter((call) => call.input !== undefined)).toEqual([
      {
        command: "gh",
        args: ["secret", "set", "ONEGAI_PROVIDER_API_KEY", "--repo", "example/project"],
        cwd: h.root,
        input: secret,
      },
    ]);
    expect(h.dependencies.readSecret).toHaveBeenCalledTimes(source === "stdin" ? 1 : 0);
    expect(h.output.join("")).not.toContain(secret);
    expect(readFileSync(join(h.root, ".github/onegai.yml"), "utf8")).not.toContain(secret);
    expect(h.output.join("")).toContain("https://github.com/example/project/pull/1");
  });

  it("skips all secret operations for Copilot", async () => {
    const h = harness();
    await init({ provider: "copilot" }, h.dependencies);
    expect(h.dependencies.readSecret).not.toHaveBeenCalled();
    expect(h.calls.some((call) => call.args[0] === "secret")).toBe(false);
    expect(h.calls.some((call) => call.args[0] === "pr")).toBe(true);
  });

  it("refuses a dirty working tree before reading a key or making changes", async () => {
    const h = harness();
    const runner = h.dependencies.runner;
    h.dependencies.runner = (command, args, options) =>
      args[0] === "status" ? Promise.resolve(" M package.json\n") : runner(command, args, options);
    await expect(init({}, h.dependencies)).rejects.toThrow(/Commit or stash/);
    expect(h.dependencies.readSecret).not.toHaveBeenCalled();
    expect(readdirSync(h.root)).toEqual([]);
    expect(h.calls.some((call) => call.args[0] === "switch")).toBe(false);
  });

  it("fails before changes if the key is empty", async () => {
    const h = harness();
    h.dependencies.readSecret.mockResolvedValue("");
    await expect(init({}, h.dependencies)).rejects.toThrow(/nonempty ONEGAI_PROVIDER_API_KEY/);
    expect(readdirSync(h.root)).toEqual([]);
    expect(h.calls.some((call) => call.args[0] === "switch")).toBe(false);
  });

  it("hides secret command errors and propagates other failures", async () => {
    const h = harness();
    const runner = h.dependencies.runner;
    h.dependencies.runner = (command, args, options) => {
      if (args[0] === "secret") throw new Error("failure with stdin-secret");
      return runner(command, args, options);
    };
    await expect(init({}, h.dependencies)).rejects.toThrow(/Could not set ONEGAI_PROVIDER_API_KEY/);
    expect(h.output.join("")).not.toContain("stdin-secret");
    expect(h.calls.some((call) => call.args[0] === "push")).toBe(false);
    const other = harness();
    const otherRunner = other.dependencies.runner;
    other.dependencies.runner = (command, args, options) => {
      if (args[0] === "api") throw new Error("HTTP 500");
      return otherRunner(command, args, options);
    };
    await expect(init({}, other.dependencies)).rejects.toThrow("HTTP 500");
  });

  it("uses the repository root when called from a subdirectory", async () => {
    const h = harness();
    h.dependencies.cwd = join(h.root, "src");
    await init({ noPr: true }, h.dependencies);
    expect(h.calls[0]?.cwd).toBe(join(h.root, "src"));
    expect(h.calls.slice(1).every((call) => call.cwd === h.root)).toBe(true);
    expect(existsSync(join(h.root, ".github/onegai.yml"))).toBe(true);
  });

  it("routes the init CLI through the injected runner and reports invalid flags", async () => {
    const h = harness();
    expect(await main(["init", "--dry-run"], h.dependencies)).toBe(0);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await main(["init", "--provider", "openai"], h.dependencies)).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("--model"));
    expect(await main(["init", "--typo"], h.dependencies)).toBe(1);
  });
});
