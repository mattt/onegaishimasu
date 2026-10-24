import { applyDiffBudget } from "./classify/diff-budget.js";
import { classify } from "./classify/classifier.js";
import type { Config } from "./config.js";
import type { Entry } from "./entry.js";
import type { GitHubClient } from "./github/api.js";
import type { Provider } from "./llm/provider.js";

/**
 * The first run anchors to the latest release: classify the merges since that tag, marked first-batch.
 * A repo with no releases starts empty.
 * There is no backfill behind the latest release, ever.
 */
export async function bootstrapEntries(
  client: GitHubClient,
  config: Config,
  provider?: Provider,
): Promise<Entry[]> {
  const tag = await client.latestTag();
  const numbers = await client.listMergedPrNumbersSinceTag(tag);

  const entries: Entry[] = [];
  const unreleasedPrs = new Set(numbers);

  for (const number of numbers) {
    const merged = await client.getMergedPr(number);
    if (merged.headRef === config.releaseBranch) continue;
    const rawDiff = await client.getPrDiff(number).catch(() => "");
    const diff = applyDiffBudget(rawDiff, { maxChars: config.diffBudget });
    const entry = await classify(
      { ...merged.input, diff },
      { provider, labelMap: config.labels, unreleasedPrs, firstBatch: true },
    );
    entries.push(entry);
  }

  return entries;
}
