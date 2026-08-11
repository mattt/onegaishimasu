import { spawn } from "node:child_process";
import type { CompletionRequest, Provider } from "./provider.js";

/** Run a command with an input string, resolving to stdout. Injectable for tests. */
export type CliRunner = (command: string, args: string[], input: string) => Promise<string>;

const defaultRunner: CliRunner = (command, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`copilot CLI exited ${code}: ${stderr}`));
    });
    child.stdin.write(input);
    child.stdin.end();
  });

export interface CopilotConfig {
  /** Model alias to pass through, e.g. `auto` or `claude-sonnet-4.6`. Coarse by design. */
  model: string;
  command?: string;
  args?: string[];
  runner?: CliRunner;
}

/**
 * The zero-secrets default: inference through the Copilot CLI, an agent harness rather than a raw API.
 * Sampling and strict schema output are not part of its contract, so the conformance loop backstops it.
 */
export class CopilotProvider implements Provider {
  readonly model: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly runner: CliRunner;

  constructor(config: CopilotConfig) {
    this.model = config.model;
    this.command = config.command ?? "copilot";
    this.args = config.args ?? ["-p", "--model", config.model];
    this.runner = config.runner ?? defaultRunner;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const prompt = [
      request.system,
      "",
      request.user,
      "",
      "Respond with ONLY a JSON object matching this JSON Schema:",
      JSON.stringify(request.jsonSchema),
    ].join("\n");
    return this.runner(this.command, this.args, prompt);
  }
}
