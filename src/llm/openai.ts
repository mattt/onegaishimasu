import type { CompletionRequest, Provider } from "./provider.js";

export interface OpenAIConfig {
  baseUrl?: string;
  apiKey: string;
  model: string;
  /** Use strict `json_schema` output. Disable for gateways that lack it. */
  structuredOutputs?: boolean;
  fetch?: typeof fetch;
}

/**
 * One fetch-based adapter for the OpenAI Chat Completions wire format.
 * OpenAI, Azure, OpenRouter, Groq, Mistral, DeepSeek, Ollama, vLLM, and most gateways speak it;
 * point `baseUrl` at any of them.
 */
export class OpenAIProvider implements Provider {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly structuredOutputs: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(config: OpenAIConfig) {
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.structuredOutputs = config.structuredOutputs ?? true;
    this.fetchFn = config.fetch ?? fetch;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const response_format = this.structuredOutputs
      ? {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            schema: request.jsonSchema,
            strict: true,
          },
        }
      : { type: "json_object" };

    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI request failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenAI response missing message content");
    }
    return content;
  }
}
