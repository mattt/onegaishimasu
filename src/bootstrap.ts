import { applyDiffBudget } from "./classify/diff-budget.js";
import { classify } from "./classify/classifier.js";
import type { Config } from "./config.js";
import type { Entry } from "./entry.js";
import type { GitHubClient } from "./github/api.js";
import type { Provider } from "./llm/provider.js";

/**
 * A cycle with no open release PR anchors to the latest release:
 * classify the merges since that tag.
 * Entries are marked first-batch only before the first release PR merges,
 * because only then could nobody have reviewed them on their PRs.
 * A repo with no tags starts empty.
 * There is no backfill behind the latest release, ever.
 */
export async function bootstrapEntries(
  client: GitHubClient,
  config: Config,
  provider?: Provider,
  options: {
    onProviderError?: (message: string) => void;
    /** PRs to classify even when tag comparison doesn't find them, such as the current ledger. */
    include?: number[];
  } = {},
): Promise<Entry[]> {
  const firstBatch = (await client.getMergedReleasePr(config.releaseBranch)) === null;
  const tag = await client.latestTag();
  const discovered = await client.listMergedPrNumbersSinceTag(tag);
  const numbers = [...new Set([...discovered, ...(options.include ?? [])])].sort((a, b) => a - b);

  const entries: Entry[] = [];
  const unreleasedPrs = new Set(numbers);

  for (const number of numbers) {
    const merged = await client.getMergedPr(number);
    if (merged.headRef === config.releaseBranch) continue;
    const rawDiff = await client.getPrDiff(number).catch(() => "");
    const diff = applyDiffBudget(rawDiff, { maxChars: config.diffBudget });
    const entry = await classify(
      { ...merged.input, diff },
      {
        provider,
        labelMap: config.labels,
        unreleasedPrs,
        firstBatch,
        onProviderError: options.onProviderError,
      },
    );
    entries.push(entry);
  }

  return entries;
}
