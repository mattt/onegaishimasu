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
3. A person reviews and corrects the release PR, then merges.
   Corrections are kept when the PR is regenerated (see [Corrections](#corrections)).

A release never happens without a person merging the release PR.

## Set up with onegai init

Run this in a clean checkout of your repository with the GitHub CLI (`gh`) installed
and signed in:

```bash
npx onegaishimasu init
```

The package exposes the `onegai` executable, so an installed copy also supports
`onegai init`.
It does the quick start's steps for you:
it writes the configuration and workflow, enables workflow PR permissions,
sets the provider secret, and opens a setup PR from `onegai/setup`.
Merge that PR to enable Onegaishimasu.
If organization policy blocks the permission change, it prints the settings
that an administrator must change.

The default provider is Anthropic with `claude-opus-5-5`.
Provide the API key through `ONEGAI_PROVIDER_API_KEY` in your environment,
or enter it at the hidden stdin prompt.
Use `--provider openai --model <name>` for OpenAI,
or `--provider copilot` for Copilot with `auto` and no secret.
Copilot requires the organization policy described in [Providers](#providers).

If a workflow in `.github/workflows/` accepts a `workflow_dispatch` input named
`tag`, setup configures it for publishing and grants `actions: write`.
Use `--publish-workflow release.yml --tag-input tag` to select a workflow and input.
If several workflows match, setup asks you to select one with the flag.

Use `--dry-run` to print all proposed files and commands without changes.
It uses read-only Git and GitHub commands to find the repository and default branch.
Use `--no-pr` to write and commit the files locally without changing settings,
setting secrets, pushing, or opening a PR.
Existing Onegaishimasu files require `--force` to replace them.

## Quick start

These steps set up Onegaishimasu with Anthropic's API,
the provider that this repository uses for its own releases.

1. In the repository's **Settings → Actions → General**,
   turn on **Allow GitHub Actions to create and approve pull requests**,
   so the action can open the release PR.
2. Add your Anthropic API key as an Actions secret named `ONEGAI_PROVIDER_API_KEY`.
3. Add `.github/onegai.yml`:

   ```yaml
   provider:
     type: anthropic
     model: claude-opus-5-5
   ```

4. Replace your release-please workflow with this one:

   ```yaml
   name: Onegaishimasu

   on:
     pull_request:
       types: [closed]
     issue_comment:
       types: [created]
     push:
       branches: [main] # your default branch
     workflow_dispatch:

   concurrency:
     group: onegai-${{ github.repository }}
     cancel-in-progress: false

   permissions:
     contents: write
     pull-requests: write
     issues: write

   jobs:
     onegai:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v7
         - uses: mattt/onegaishimasu@v0
           with:
             provider-api-key: ${{ secrets.ONEGAI_PROVIDER_API_KEY }}
   ```

`@v0` follows the latest 0.x release.
Pin a full version such as `@v0.1.0`, or a commit SHA, to stay on one release.

The `push` trigger detects a merged release PR and publishes the release.
The `pull_request` and `issue_comment` triggers classify merges and accept corrections.
The `workflow_dispatch` trigger rebuilds the release PR on demand:
it classifies every merge since the latest release again,
for example after you change the provider or the configuration,
and keeps the fields that someone corrected.

## Publishing

Onegaishimasu publishes the GitHub release, not packages.
If a workflow publishes your package when a tag is pushed,
know that a tag created with `GITHUB_TOKEN` doesn't start it.
Instead, give that workflow a `workflow_dispatch` trigger with an input for the tag,
and name it in `.github/onegai.yml`:

```yaml
publish:
  workflow: release.yml
  tagInput: tag # the default
```

After each new release, Onegaishimasu starts that workflow at the release tag,
with the tag, such as `v1.2.0`, as the input.
Add `actions: write` to the Onegaishimasu workflow's permissions.

## Providers

Set the provider in `.github/onegai.yml`.
An adapter for Anthropic Messages and one for the OpenAI Chat Completions format
(OpenAI, Azure, OpenRouter, Groq, Mistral, DeepSeek, Ollama, vLLM, any gateway)
take their key from the `provider-api-key` input, as in the quick start:

```yaml
# .github/onegai.yml
provider:
  type: openai
  model: gpt-5.6-terra
  baseUrl: https://api.openai.com/v1
```

GitHub Copilot needs no secret,
but only on organization repositories whose Copilot policy allows the Copilot CLI,
which the action runs.
Set `type: copilot` (the default, with `model: auto`),
and change the workflow to grant the permission, install the CLI, and pass it the token:

```yaml
permissions:
  contents: write
  pull-requests: write
  issues: write
  copilot-requests: write

jobs:
  onegai:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm install -g @github/copilot
      - uses: mattt/onegaishimasu@v0
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

The Copilot and OpenAI-compatible providers have not run in a live release yet.

## Corrections

There are two ways to correct an entry and one way to add your own text, and none of them goes through a model:

- Comment on the merged PR with a command.
  The correction applies to the release notes and `CHANGELOG.md`,
  and later regenerations keep it.
  - `/onegai kind: fix`
  - `/onegai summary: <text>`
  - `/onegai notes:` followed by the notes on the next lines
  - `/onegai pin` keeps every field as it is now
  - `/onegai reclassify` runs the model again (the only command that does)
- Edit a section of the release notes in the release PR body.
  The whole section then stays as you wrote it:
  entries of that kind merged later are not added to it,
  and `CHANGELOG.md` still uses the entries' summaries.
  Prefer commands for corrections to a single entry.
- Write an introduction in the release PR body,
  under "## Release notes" and above the first generated section.
  Regeneration keeps it as you wrote it, and the published release starts with it.

Commands are limited to the PR author and users with write access,
and work until the release that contains the PR merges.
Onegaishimasu reacts with 👍 after the release PR is updated.
It reacts with 👎 to a command from anyone else,
and replies with the reason when a command is invalid or the PR is already released.

To choose the next version yourself,
add a `Release-As: 1.0.0` line to the body of a PR before it merges.
The release PR then proposes exactly that version.
When several unreleased PRs carry one, the highest version wins.

## CLI

Preview a release from the ledger without writing anything:

```bash
onegai preview --dir .onegai/entries --current 1.2.0
onegai preview --body saved-release-pr-body.md --current 1.2.0
```

## Configuration

Configure in `.github/onegai.yml`.
Every field is optional; see [.github/onegai.yml](.github/onegai.yml) for the annotated defaults.

| Field                           | Default                             | Meaning                                       |
| ------------------------------- | ----------------------------------- | --------------------------------------------- |
| `provider.type`                 | `copilot`                           | `copilot`, `openai`, or `anthropic`           |
| `provider.model`                | `auto` (Copilot)                    | Required for `openai` and `anthropic`         |
| `provider.baseUrl`              | —                                   | OpenAI-compatible gateway URL                 |
| `diffBudget`                    | `12000`                             | Character budget for the sampled diff         |
| `preOneZero.capBreakingAtMinor` | `true`                              | Cap breaking at minor before 1.0.0            |
| `render.announcement`           | `false`                             | Announcement draft for minor/major            |
| `render.credits`                | `true`                              | Contributor credits (not yet wired in)        |
| `commentOnMerge`                | `true`                              | Comment the entry on the merged PR            |
| `releaseBranch`                 | `onegai/release`                    | Branch carrying staged changes                |
| `floatingMajorTag`              | `false`                             | Move `v<major>` to each release (for actions) |
| `publish.workflow`              | —                                   | Workflow to start at each new release's tag   |
| `publish.tagInput`              | `tag`                               | Its input that receives the tag               |
| `manifestFiles`                 | `[package.json, package-lock.json]` | Manifests to bump                             |
| `voicePath`                     | —                                   | House style for notes (not yet wired in)      |
| `labels`                        | —                                   | Map repository labels to kinds                |

## The ledger

Entries do not live in your tree.
The record of truth is the release PR itself:
each regeneration writes the full entry set into the PR body as fenced YAML inside a `<details>` block.
When the release PR merges, the closed PR archives the entries.

See [docs/entry-schema.md](docs/entry-schema.md) for the entry schema, the public interface other tools can consume.

## Scope for v1

npm ecosystem only.
No registry publishing of its own (it starts your publish workflow; see [Publishing](#publishing)), no monorepo coordination, no pre-release channels.
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
