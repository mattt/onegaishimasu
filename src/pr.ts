/** The merged pull request, the unit of change Onegaishimasu classifies. */
export interface PullRequestInput {
  number: number;
  title: string;
  body: string;
  /** Author login, e.g. `octocat` or `dependabot[bot]`. */
  author: string;
  labels: string[];
  /** The squash/merge commit SHA, used to key the artifact. */
  mergeSha?: string;
  /** Login credits for the release notes. */
  contributors?: string[];
  /** Unified diff, already reduced to a token budget. Optional. */
  diff?: string;
}
