import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { KINDS } from "./entry.js";

/** Configuration from `.github/onegai.yml`, with defaults applied. */
export const configSchema = z.object({
  provider: z
    .object({
      type: z.enum(["copilot", "openai", "anthropic"]).default("copilot"),
      model: z.string().optional(),
      baseUrl: z.string().optional(),
    })
    .prefault({})
    // Copilot defaults to `auto` so the model name never goes stale;
    // BYO providers have no evergreen alias, so the model must be explicit.
    .transform((provider, ctx) => {
      const model = provider.model ?? (provider.type === "copilot" ? "auto" : undefined);
      if (!model) {
        ctx.addIssue({
          code: "custom",
          message: `provider.model is required when provider.type is "${provider.type}"`,
        });
        return z.NEVER;
      }
      return { ...provider, model };
    }),
  diffBudget: z.number().int().positive().default(12000),
  preOneZero: z
    .object({
      capBreakingAtMinor: z.boolean().default(true),
    })
    .prefault({}),
  render: z
    .object({
      announcement: z.boolean().default(false),
      credits: z.boolean().default(true),
    })
    .prefault({}),
  voicePath: z.string().optional(),
  /** Comment the classified entry on the merged PR so the author can correct it. */
  commentOnMerge: z.boolean().default(true),
  labels: z.record(z.string(), z.enum(KINDS)).optional(),
  releaseBranch: z.string().default("onegai--release"),
  manifestFiles: z.array(z.string()).default(["package.json", "package-lock.json"]),
});

export type Config = z.infer<typeof configSchema>;

/** Parse config from YAML text, applying defaults. */
export function parseConfig(text: string | null | undefined): Config {
  if (!text || text.trim().length === 0) return configSchema.parse({});
  return configSchema.parse(parseYaml(text) ?? {});
}

/** Load config from a path, falling back to defaults when the file is absent. */
export function loadConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return configSchema.parse({});
  }
  return parseConfig(text);
}
