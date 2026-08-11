import type { Config } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { CopilotProvider } from "./copilot.js";
import { OpenAIProvider } from "./openai.js";
import type { Provider } from "./provider.js";

/**
 * Copilot is the zero-secrets default; a BYO key selects the OpenAI-compatible or Anthropic adapter.
 * A missing BYO key yields no provider, so classification falls back to deterministic signals alone.
 */
export function createProvider(config: Config, apiKey?: string): Provider | undefined {
  const { type, model, baseUrl } = config.provider;
  switch (type) {
    case "openai":
      return apiKey ? new OpenAIProvider({ apiKey, model, baseUrl }) : undefined;
    case "anthropic":
      return apiKey ? new AnthropicProvider({ apiKey, model, baseUrl }) : undefined;
    case "copilot":
      return new CopilotProvider({ model });
  }
}
