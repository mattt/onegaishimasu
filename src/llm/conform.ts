import type { z } from "zod";
import { type Provider, extractJson } from "./provider.js";

export type ConformResult<T> =
  | { ok: true; value: T; raw: string }
  | { ok: false; raw: string; errors: string };

function retryHint(raw: string, errors: string): string {
  return [
    "",
    "Your previous response did not satisfy the required schema.",
    "Previous response:",
    raw,
    "",
    "Validation errors:",
    errors,
    "",
    "Respond again with ONLY a JSON object that satisfies the schema.",
  ].join("\n");
}

function validate<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; errors: string } {
  const json = extractJson(raw);
  if (json === null) {
    return { ok: false, errors: "No JSON object found in the response." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: `Invalid JSON: ${(e as Error).message}` };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n"),
  };
}

/**
 * Ask for JSON, validate, feed errors back for one retry, then give up.
 * This works even when a provider ignores strict structured-output hints.
 */
export async function completeWithSchema<T>(
  provider: Provider,
  request: {
    system: string;
    user: string;
    jsonSchema: Record<string, unknown>;
    schemaName: string;
    zodSchema: z.ZodType<T>;
  },
): Promise<ConformResult<T>> {
  const { system, user, jsonSchema, schemaName, zodSchema } = request;

  const first = await provider.complete({ system, user, jsonSchema, schemaName });
  const firstResult = validate(first, zodSchema);
  if (firstResult.ok) return { ok: true, value: firstResult.value, raw: first };

  const second = await provider.complete({
    system,
    user: user + retryHint(first, firstResult.errors),
    jsonSchema,
    schemaName,
  });
  const secondResult = validate(second, zodSchema);
  if (secondResult.ok) return { ok: true, value: secondResult.value, raw: second };

  return { ok: false, raw: second, errors: secondResult.errors };
}
