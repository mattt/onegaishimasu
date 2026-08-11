import type { CompletionRequest, Provider } from "./provider.js";

export interface AnthropicConfig {
  baseUrl?: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  fetch?: typeof fetch;
}

/**
 * A native Anthropic Messages adapter.
 * The OpenAI-compat shim ignores `response_format` and `strict`, so we go native and force a single tool call whose input schema is ours;
 * that is the reliable way to get constrained JSON from the Messages API.
 */
export class AnthropicProvider implements Provider {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: AnthropicConfig) {
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.maxTokens = config.maxTokens ?? 1024;
    this.fetchFn = config.fetch ?? fetch;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0,
        system: request.system,
        tools: [
          {
            name: request.schemaName,
            description: "Emit the classification as structured data.",
            input_schema: request.jsonSchema,
          },
        ],
        tool_choice: { type: "tool", name: request.schemaName },
        messages: [{ role: "user", content: request.user }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic request failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      content?: { type: string; input?: unknown }[];
    };
    const toolUse = data.content?.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.input === undefined) {
      throw new Error("Anthropic response missing tool_use input");
    }
    return JSON.stringify(toolUse.input);
  }
}
