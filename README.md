# Onegaishimasu

A GitHub Action that maintains a release pull request the way release-please does,
but decides versions and writes release notes from the merged changes rather than commit-message conventions.
The CLI is `onegai`.

## How it works

Onegaishimasu keeps a release PR open against your default branch.
The PR branch carries the staged changes (bumped version manifests, rendered `CHANGELOG.md`), so merging applies them.
A post-merge step tags and publishes the GitHub Release.

1. When a PR merges, the action classifies it into a structured entry:
   kind of change, user-facing summary, draft notes, and the evidence for the classification.
   It comments the entry on the merged PR so the author can correct it while the context is fresh.
2. The release PR is regenerated from the accumulated entries:
   proposed version, changelog diff, release body.
3. A person edits anything, then merges.
   Edited material is pinned; the generator never overwrites it.

A release never happens without a person merging the release PR.

## Quick start

Swap your release-please workflow for this one:

```yaml
name: Onegaishimasu

on:
  pull_request:
    types: [closed]
  issue_comment:
    types: [created]
  push:
    branches: [main]

concurrency:
  group: onegai-${{ github.repository }}
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write
  issues: write
  # copilot-requests: write   # org repos using the Copilot default

jobs:
  onegai:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: owner/onegaishimasu@v1
```

The `push` trigger detects a merged release PR and publishes the release.
The `pull_request` and `issue_comment` triggers classify merges and accept corrections.

## Providers

The default is GitHub Copilot, which needs no secrets:
on org-owned repos with the policy enabled, the built-in `GITHUB_TOKEN` carries `copilot-requests: write`,
and inference stays inside GitHub.
The action runs the [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions),
so install it before the action and pass it the token:

```yaml
- uses: actions/checkout@v7
- run: npm install -g @github/copilot
- uses: owner/onegaishimasu@v1
  env:
    GITHUB_TOKEN: ${{ github.token }}
```

To use a specific model, bring your own key.
One adapter speaks the OpenAI Chat Completions format (OpenAI, Azure, OpenRouter, Groq, Mistral, DeepSeek, Ollama, vLLM, any gateway);
another speaks Anthropic Messages.

```yaml
# .github/onegai.yml
provider:
  type: openai
  model: gpt-5.6-terra
  baseUrl: https://api.openai.com/v1
```

```yaml
- uses: owner/onegaishimasu@v1
  with:
    provider-api-key: ${{ secrets.ONEGAI_PROVIDER_API_KEY }}
```

## Corrections

There are two ways to correct an entry, and neither goes through a model:

- Edit the release PR body directly.
  Any divergence from generated text is detected and pinned.
- Comment on the merged PR with a command:
  - `/onegai kind: fix`
  - `/onegai summary: <text>`
  - `/onegai notes: <text or multi-line body>`
  - `/onegai pin`
  - `/onegai reclassify` (the only command that re-runs the model)

Commands are limited to the PR author and users with write access.

## CLI

Preview a release from the ledger without writing anything:

```bash
onegai preview --dir .onegai/entries --current 1.2.0
onegai preview --body saved-release-pr-body.md --current 1.2.0
```

## Configuration

Configure in `.github/onegai.yml`.
Every field is optional; see [.github/onegai.yml](.github/onegai.yml) for the annotated defaults.

| Field                           | Default                             | Meaning                                 |
| ------------------------------- | ----------------------------------- | --------------------------------------- |
| `provider.type`                 | `copilot`                           | `copilot`, `openai`, or `anthropic`     |
| `provider.model`                | `auto` (Copilot)                    | Required for `openai` and `anthropic`   |
| `provider.baseUrl`              | —                                   | OpenAI-compatible gateway URL           |
| `diffBudget`                    | `12000`                             | Character budget for the sampled diff   |
| `preOneZero.capBreakingAtMinor` | `true`                              | Cap breaking at minor before 1.0.0      |
| `render.announcement`           | `false`                             | Announcement draft for minor/major      |
| `render.credits`                | `true`                              | Contributor credits in the release body |
| `commentOnMerge`                | `true`                              | Comment the entry on the merged PR      |
| `releaseBranch`                 | `onegai--release`                   | Branch carrying staged changes          |
| `manifestFiles`                 | `[package.json, package-lock.json]` | Manifests to bump                       |
| `voicePath`                     | —                                   | House-style instructions file           |
| `labels`                        | —                                   | Map repository labels to kinds          |

## The ledger

Entries do not live in your tree.
The record of truth is the release PR itself:
each regeneration writes the full entry set into the PR body as fenced YAML inside a `<details>` block.
When the release PR merges, the closed PR archives the entries.

See [docs/entry-schema.md](docs/entry-schema.md) for the entry schema, the public interface other tools can consume.

## Scope for v1

npm ecosystem only.
No registry publishing (compose with your existing publish workflow), no monorepo coordination, no pre-release channels.
The first run classifies merges since your latest release tag and flags them as unreviewed.
Nothing behind the latest release is backfilled.

## Development

Built on [Vite+](https://viteplus.dev): `vp` manages the Node runtime, tests, coding standards, and the bundle.

```bash
vp install
vp test          # Vitest
vp check         # format, lint, and type-check in one pass
vp pack          # bundles dist/index.cjs and dist/cli.cjs
```

## License

Apache-2.0.
