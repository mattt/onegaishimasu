/**
 * The diff is the highest-signal input but the costliest and largest injection surface.
 * So it is sampled under a budget: API surface and manifests first, lockfiles and generated files excluded, never shipped raw.
 */

export interface DiffBudgetOptions {
  /** Character budget for the reduced diff. */
  maxChars: number;
}

const EXCLUDE_RE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|.*\.min\.(js|css)|.*\.snap)$|(^|\/)(dist|build|node_modules|vendor|generated)\//;

const MANIFEST_RE = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/;
const API_RE = /(^|\/)(src|lib|include)\/|\.d\.ts$|(^|\/)index\.[a-z]+$/;
const TEST_RE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/;

interface FileChunk {
  path: string;
  text: string;
  priority: number;
}

function pathOf(chunk: string): string {
  const git = chunk.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
  if (git?.[2]) return git[2];
  const plus = chunk.match(/^\+\+\+ b\/(.+)$/m);
  if (plus?.[1]) return plus[1];
  return "";
}

function priorityOf(path: string): number {
  if (MANIFEST_RE.test(path)) return 0;
  if (TEST_RE.test(path)) return 2;
  if (API_RE.test(path)) return 1;
  return 2;
}

export function splitDiff(diff: string): FileChunk[] {
  if (!diff.trim()) return [];
  const parts = diff.split(/(?=^diff --git )/m).filter((p) => p.trim().length > 0);
  return parts.map((text) => {
    const path = pathOf(text);
    return { path, text, priority: priorityOf(path) };
  });
}

/** Reduce a diff to fit the budget, dropping excluded files and ordering by signal. */
export function applyDiffBudget(diff: string, options: DiffBudgetOptions): string {
  const chunks = splitDiff(diff).filter((c) => !EXCLUDE_RE.test(c.path));
  chunks.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));

  const kept: string[] = [];
  const omitted: string[] = [];
  let used = 0;

  for (const chunk of chunks) {
    if (used >= options.maxChars) {
      omitted.push(chunk.path || "(unknown)");
      continue;
    }
    const remaining = options.maxChars - used;
    if (chunk.text.length <= remaining) {
      kept.push(chunk.text.trimEnd());
      used += chunk.text.length;
    } else {
      kept.push(`${chunk.text.slice(0, remaining).trimEnd()}\n... (truncated)`);
      used = options.maxChars;
      omitted.push(chunk.path || "(unknown)");
    }
  }

  let result = kept.join("\n");
  if (omitted.length > 0) {
    result += `\n\n... (${omitted.length} more file(s) omitted for budget: ${omitted.join(", ")})`;
  }
  return result;
}
