# Onegaishimasu

Initial spec, August 2026. Working draft for discussion.

A GitHub Action that maintains a release pull request the way release-please does, but decides versions and writes release notes from evidence rather than from commit-message conventions alone. The name continues the lineage: release-please asked politely, onegaishimasu asks more politely still. The CLI answers to `onegai`.

## Problem

Cutting a release means answering three questions. What changed? What version does that imply? How do we describe it to people who weren't in the room? release-please answers all three by parsing Conventional Commits out of git history and staging the result in a release PR. The release PR was the right idea: a durable, reviewable, mergeable artifact that *is* the release. Everything upstream of it is the weak part.

Conventional Commits is a lossy, human-operated encoding of intent. People mislabel, forget the `!`, write `chore:` for things users care about, and squash merges flatten whatever discipline existed on the branch. When the encoding is wrong the version is wrong, and either way the changelog is a transcription of commit subject lines, which nobody wants to read. Breaking-change detection rests entirely on an author remembering to declare it.

The LLM tools that have appeared this cycle attack only the third question. They take two refs and produce prose. They don't compute versions, update manifests, or give you a review surface, and most of them want an OpenAI key in your secrets. Nothing currently owns the full loop with inference inside it. That's the opening.

## Shape

Same outer shape as release-please, deliberately. Onegaishimasu maintains a release PR against the default branch, and the PR's branch carries the staged changes — version manifests bumped, `CHANGELOG.md` rendered — so merging applies them; the post-merge step only tags and publishes the GitHub Release. Someone coming from release-please should be able to swap the workflow file and keep their habits.

The loop underneath is different:

1. When a PR merges, the action classifies it: kind of change, user-facing summary, draft notes. It emits a structured entry (below) and optionally comments the entry on the merged PR so the author can correct it while context is fresh.
2. Entries accumulate. The release PR is regenerated from them: proposed version, changelog diff, release body.
3. A human edits anything, then merges. Edited material is pinned; the generator never overwrites it.

Classifying at merge time rather than in one batch at release time spreads inference cost, makes each judgment correctable by the one person with context, and turns release day into a skim instead of an archaeology dig. The release PR is assembled from records someone had a chance to vet, rather than generated fresh at the end.

## Principles

A human merges the release — a ceiling, not a default. There is no configuration in which a release happens without a person's click, not even auto-merged patch bumps built from high-confidence entries. Model output is always staged in reviewable form and never lands directly on a tag; the moment it can, every upstream safeguard becomes advisory.

Evidence outranks inference. Every entry carries the evidence for its classification. Explicit signals beat the model: a Conventional Commit prefix, a label, a `Release-As` footer. Deterministic analyzers beat the model too: where the ecosystem has real API diffing (cargo-semver-checks, swift-api-digester, apidiff for Go), that verdict on "breaking" is authoritative and the model only writes prose. The model fills gaps left by missing signals and never overrules an explicit one.

Conventions honored, never required. A repo with disciplined Conventional Commits gets deterministic behavior equivalent to release-please. A repo with none gets inference. Most repos sit in between and get both.

Stable under re-runs. An entry is a write-once record of judgment, not a cache of a reproducible computation. A PR is classified once, at merge, and the result persisted; re-runs read the stored entry and never re-infer. This is a stronger guarantee than pinned-model determinism — which hosted inference doesn't honor anyway — because nothing depends on the provider being reproducible at all. The entry doesn't churn for the same reason a code review doesn't get re-run when the reviewer leaves: it was a judgment made with context, vetted at the time, and superseded only by a newer judgment. Re-classification happens only on explicit human request. Temperature 0 still applies within a single classification attempt so retries converge; nothing depends on it across attempts.

## The unit of change is the PR

Most repositories squash-merge, so the commit stream is really the PR stream. release-please parses commits; Onegaishimasu treats the merged PR as the atom: title, body, linked issues, diff, review discussion. This matches how GitHub is actually used and gives the classifier far richer input than a subject line.

The classifier sees the diff, but under a size budget: truncated and sampled (public API surface and manifest changes prioritized, lockfiles and generated files excluded) rather than shipped whole. The diff is the highest-signal input, but it dominates token cost and is the largest injection surface, so the budget is a first-class config knob rather than an implementation detail.

## Entries

Per merged PR the action emits something like:

```yaml
schema: 1
pr: 482
kind: feature        # breaking | feature | fix | perf | deps | docs | internal | unknown
confidence: high     # high | medium | low (derived, below)
evidence:
  - conventional-commit: "feat(client): add retry policy"
  - api-diff: "new public symbol RetryPolicy"
summary: Add a configurable retry policy to `Client`.
notes: |
  Requests failing with a retryable status are now retried with
  exponential backoff. Configure via `ClientOptions.retryPolicy`.
pinned: false
```

One entry per PR, one kind per entry: a PR that both adds a feature and breaks an API is `breaking` — kind is the most severe applicable classification, and the notes carry the rest. `unknown` is the honest failure mode — schema validation failed twice, or the provider was unreachable — and exists so failure never masquerades as a judgment. Two classes of PR skip inference entirely: dependency-bot PRs (dependabot, renovate) are `deps` by author and title pattern, and a revert of an unreleased PR marks both itself and its target `internal` — they cancel, and neither belongs in the notes. A revert of already-released work is just another change.

`confidence` is derived, not self-reported — model self-assessment is uncalibrated flattery and doesn't get a vote. Corroborating evidence is high by construction (explicit signal, analyzer verdict, or both in agreement); model-only inference caps out at medium; conflicting signals surface loudly regardless of which one wins the classification. Entries also record the model and prompt version that produced them: provenance for debugging, never a cache key. The `schema` field lets the ledger evolve without invalidating old entries.

Entries stay out of the tree. In-repo files were the obvious answer and are rejected: every merge would produce a follow-up bot commit to the default branch — doubled commit traffic, a direct push that branch protection outright forbids on exactly the repos that care most, and a fight with merge queues — all to store a record nobody wants in code review's way. (The permission isn't the objection: the action holds `contents: write` regardless, for the release branch and tags. The objection is unreviewed commits landing on the default branch.)

Storage is layered instead. Each classification run persists its entry as a workflow artifact keyed by merge SHA: free, invisible, queryable by API, and immutable, a faithful record of what the classifier originally said. Artifacts expire, though, so they are provenance rather than ledger. The ledger is the release PR itself: every regeneration snapshots the full entry set into the PR body inside a `<details>` block — fenced YAML between HTML-comment markers, so parsing never depends on how GitHub happens to render it — spilling into bot comments if it outgrows the 65k body limit. This is the release-please move — the PR as database — embraced deliberately rather than backed into: the ledger lives exactly where it gets reviewed, corrections are edits to it (which is what pinning protects), and it dies naturally on merge, where "dies" means "is archived," since the closed release PR preserves each release's ledger permanently. Reads prefer the snapshot, since it carries the human edits; artifacts back it up and preserve the uncorrected originals.

Corrections have two doors and one shared property: neither passes through a model. Editing the release PR snapshot directly is the release manager's path. Comment commands on the merged PR (`/onegai kind: fix`, `/onegai summary: ...`) are the author's path, and they are a deterministic grammar — permission-gated to the author and users with write access, parsed rather than interpreted, writing the given text verbatim into the named field. There is deliberately no "ask the model to rewrite this" command: that would hand a privileged write channel to anyone who can type a comment. Comment text already reaches the classifier once, at classification time, delimited as data; commands are a second, more privileged channel, so they get parser-level rigor instead of a prompt. The command set stays small: verbatim field writes (`kind`, `summary`, `notes`), `/onegai pin`, and `/onegai reclassify` — the one command that does reach a model, permission-gated like the rest, and it re-runs the standard pipeline for a fresh judgment rather than accepting instructions.

Pinning is detected, not declared. The snapshot records what the generator last wrote; any divergence found on the next run is a human edit, marked pinned and preserved verbatim from then on. This works field-by-field on entries and section-by-section on the rendered prose in the release PR body — humans may edit either layer, and regeneration flows new material around pinned text, never over it.

Self-served — the CLI from a laptop, or a CI that isn't Actions — persistence is explicitly the consumer's problem. The interface is a directory of entry files; where that directory durably lives is suggested, not prescribed: a cache step, a bucket, an orphan branch in the style of gh-pages.

## Version computation

The proposed bump is the max over unreleased entries: breaking changes bump major; features bump minor; fixes, perf, and dependency bumps bump patch; docs and internal changes bump nothing. `unknown` bumps nothing but renders as a blocker-shaped warning at the top of the release PR until a human resolves it. Pre-1.0 gets a configurable mode where breaking changes cap at minor. The release PR shows the bump alongside the entries that caused it, so the reasoning is inspectable. A low-confidence "breaking" from the model is surfaced loudly in the PR rather than silently applied; a deterministic analyzer's verdict is applied without ceremony.

## Notes

One set of entries, three renderings:

- `CHANGELOG.md`: terse, one line per entry, keep-a-changelog compatible.
- GitHub Release body: grouped sections in real prose, migration guidance under breaking changes, dependency bumps collapsed to a line, contributor credits.
- Announcement draft (optional, off by default): blog-post-shaped prose for minor and major releases.

Voice is configurable through an instructions file in the repo, the same pattern GitHub's copilot-release-notes uses, so a project's house style survives contributor turnover.

The renderings are deliberately the shallow layer: stateless functions from entries to text, re-runnable and replaceable without touching stored judgment. That asymmetry is the answer to which piece is the actual product. Any two-refs-to-prose tool can write release notes, and every model generation makes that easier for everyone including us; what accumulates here and nowhere else is a ledger of vetted, evidence-bearing classifications. The classifier is the product and the writer is the demo — the thing that gets screenshotted, built on an asset it didn't create. Design attention goes to the entry schema and evidence model first; the schema is the public interface (other tools should be able to consume the ledger), and prose can launch merely fine and improve forever at zero migration cost, since re-rendering never touches entries.

## LLM plumbing

The zero-secrets default this category wants died with GitHub Models (retired July 2026). The GitHub-native successor is Copilot: on org-owned repos with the policy enabled, the built-in `GITHUB_TOKEN` can carry `copilot-requests: write`, which preserves the no-stored-PAT property and keeps content inside GitHub's boundary, but the inference surface is the Copilot CLI — an agent harness, not a raw API. Sampling controls and strict schema output aren't part of its contract, and its model names are coarse aliases for whatever Copilot currently serves. The write-once entry model makes this survivable: nothing ever needs re-inferring under the same model, and schema conformance is enforced on our side regardless. Ship Copilot as the one-click default; treat BYO key as the primary path for anyone who wants a specific model, not the afterthought it was in the original design.

The provider abstraction can be tiny because the need is tiny: one call shape — single-shot, schema-constrained classification, no streaming, no tool loop, no conversation state. `complete(system, user, schema) → JSON` is the entire interface, which is why a unified-LLM dependency (Vercel AI SDK, pi-ai) buys little here; those libraries earn their weight on agent loops and streaming, none of which we use. The convention to lean into is the OpenAI Chat Completions wire format, the lingua franca nearly every provider speaks natively: a provider is a `{base_url, api_key, model}` triple, and one fetch-based adapter covers OpenAI, Azure AI Foundry, OpenRouter, Groq, Mistral, DeepSeek, Ollama, vLLM, and any gateway the user points `base_url` at. Add one native Anthropic Messages adapter, because Anthropic's OpenAI-compat shim ignores `response_format` and `strict` — exactly the parts we need. Two adapters plus the Copilot path, a few hundred lines, no LLM SDK dependencies.

Schema conformance is enforced on our side, never trusted from the provider. Use strict structured outputs where they exist (OpenAI's `json_schema`, Anthropic's `output_config`), but the portable mechanism is: ask for JSON, validate against the entry schema, feed validation errors back for one retry, and on second failure emit a `kind: unknown` entry at low confidence rather than guessing. Keeping the entry schema flat — string enums, required fields, no unions or conditionals — keeps it inside the schema subset every provider's constrained decoding actually supports.

PR bodies are attacker-controlled input that flows into text published under the project's name, so prompt injection is a first-class threat here. PR content gets delimited and sanitized as data, outputs are constrained to the entry schema, and the human gate backstops everything. GitHub put copilot-release-notes through several rounds of adversarial review for exactly this reason; match that bar.

## Architecture

A TypeScript Action plus a CLI for local dry runs (`onegai preview` prints the entry set, proposed version, and rendered notes — reading the ledger, writing nothing). There is no backfill command. Adoption anchors to the latest release: the first run classifies the merges since that tag — the loop's normal work, just with a longer queue — and history behind the latest release is out of scope forever. A repo with no releases starts empty and releases forward from install. Entries from that first batch carry a marker so the release PR can flag that nobody reviewed them while context was fresh. v1 ships the npm ecosystem only — the Action is TypeScript, so the project dogfoods itself from its first release, and the library dependency makes each further ecosystem a small addition rather than a port. The core is clean room — the loop, classifier, entry model, and PR management owe nothing to release-please's architecture — but release-please is consumable as a library, and its updaters encode years of version-file rewriting across twenty-odd ecosystems under Apache-2.0. That machinery is boring in the best way, so depend on it for manifest updates rather than forking or rewriting it. If the dependency chafes later, the updater interface is the seam to reimplement behind.

Operationally, the Action subscribes to three events: `pull_request` closed-and-merged (classify, then regenerate the release PR), `issue_comment` created (commands), and `push` to the default branch (detect a merged release PR; tag and publish). Regeneration is serialized through an Actions concurrency group keyed by repo — two merges racing to rewrite the snapshot is ledger corruption, not a tolerable last-writer-wins. Classification runs in the default-branch workflow context and never executes code from the classified PR; it only reads content. Permissions: `contents: write` for the release branch and tags, `pull-requests: write` and `issues: write` for the release PR and comments, plus the Copilot request permission under the default provider. Configuration lives at `.github/onegai.yml`: provider and model, diff budget, pre-1.0 mode, rendering toggles, and the path to the voice instructions file.

## Non-goals for v1

Registry publishing (compose with existing publish workflows, as release-please does). Monorepo coordination (design the entry model so per-package scoping can come later; don't build it first). Pre-release channels. Anything that isn't GitHub — the forge, that is; the CLI itself runs anywhere.

## Open questions

The load-bearing decisions are made: entries out of the tree with the release PR as ledger, corrections through two model-free doors, npm first, adoption anchored to the latest release, and a hard human-merge ceiling. What remains is finer-grained: the exact comment-command grammar, how the snapshot's spill-to-comments behaves at pathological release sizes, and whether the announcement rendering earns its place or gets cut.
