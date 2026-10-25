import Anthropic from "@anthropic-ai/sdk";
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
 * Structured outputs constrain the response to our JSON Schema.
 * Current models reject a forced `tool_choice` and sampling parameters,
 * so the request sends neither.
 */
export class AnthropicProvider implements Provider {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(config: AnthropicConfig) {
    this.model = config.model;
    // Thinking counts against `max_tokens` and is always on for current models,
    // so leave room beyond the short JSON answer.
    this.maxTokens = config.maxTokens ?? 16000;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      fetch: config.fetch,
    });
  }

  async complete(request: CompletionRequest): Promise<string> {
    // `$schema` is metadata, not a constraint.
    const { $schema: _, ...schema } = request.jsonSchema;
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: request.system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: request.user }],
    });

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category ?? "unspecified";
      throw new Error(`Anthropic declined the request (category: ${category})`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error(`Anthropic response hit max_tokens (${this.maxTokens})`);
    }

    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    if (!text) throw new Error("Anthropic response has no text content");
    return text;
  }
}
