/** A single-shot, schema-constrained completion request. No streaming, no tools. */
export interface CompletionRequest {
  system: string;
  user: string;
  /** JSON Schema the output must satisfy. */
  jsonSchema: Record<string, unknown>;
  /** A stable name for the schema, used by providers that require one. */
  schemaName: string;
}

/**
 * The entire provider interface.
 * `complete` returns raw text; conformance is enforced on our side, never trusted from the wire.
 */
export interface Provider {
  readonly model: string;
  complete(request: CompletionRequest): Promise<string>;
}

/** Extract the first JSON object from provider text, tolerating fences and prose. */
export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}
