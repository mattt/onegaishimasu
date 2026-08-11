# Entry schema

An entry is a write-once record of judgment about one merged PR.
The schema is the public interface: other tools should be able to consume the ledger.
It is kept flat — string enums, required fields, no unions — so it stays inside the constrained-decoding subset every LLM provider supports.

## Example

```yaml
schema: 1
pr: 482
kind: feature
confidence: high
evidence:
  - source: conventional-commit
    detail: "feat(client): add retry policy"
    impliedKind: feature
  - source: api-diff
    detail: "new public symbol RetryPolicy"
    impliedKind: feature
summary: Add a configurable retry policy to `Client`.
notes: |
  Requests failing with a retryable status are now retried with
  exponential backoff. Configure via `ClientOptions.retryPolicy`.
pinned: []
conflict: false
firstBatch: false
provenance:
  model: gpt-5.6-terra
  promptVersion: "1"
```

## Fields

| Field        | Type                        | Meaning                                                                  |
| ------------ | --------------------------- | ------------------------------------------------------------------------ |
| `schema`     | `1`                         | Schema version. Lets the ledger evolve without invalidating old entries. |
| `pr`         | integer                     | The merged PR number. One entry per PR.                                  |
| `kind`       | enum                        | The most severe applicable classification.                               |
| `confidence` | `high` \| `medium` \| `low` | Derived, not self-reported.                                              |
| `evidence`   | list                        | The signals behind the classification.                                   |
| `summary`    | string                      | One terse user-facing line.                                              |
| `notes`      | string                      | Prose for the release body, including migration guidance.                |
| `pinned`     | list                        | Fields a human edited; never overwritten.                                |
| `conflict`   | boolean                     | Signals disagreed; surfaced loudly.                                      |
| `firstBatch` | boolean                     | Classified in the first run, unreviewed while fresh.                     |
| `provenance` | object                      | Model and prompt version. Debugging, never a cache key.                  |

## Kinds

Ordered least to most severe: `unknown`, `internal`, `docs`, `deps`, `perf`, `fix`, `feature`, `breaking`.

A PR that both adds a feature and breaks an API is `breaking` — the most severe applies, and the notes carry the rest.
`unknown` is the honest failure mode: schema validation failed twice, or the provider was unreachable.
It exists so failure never masquerades as a judgment.

## Confidence

Derived from evidence, never from model self-report:

- **high**: a deterministic signal is present (conventional commit, label,
  `Release-As`, or an analyzer verdict).
- **medium**: model-only inference.
- **low**: no evidence at all.

`conflict` is flagged whenever the evidence implies more than one kind, regardless of which kind wins.

## Evidence sources

`conventional-commit`, `label`, `release-as`, `api-diff`, `bot`, `revert` are deterministic and outrank the model.
`model` is inference and fills gaps only; it never overrules an explicit signal.

## Version mapping

`breaking` bumps major;
`feature` bumps minor;
`fix`, `perf`, and `deps` bump patch;
`docs`, `internal`, and `unknown` bump nothing.
`unknown` renders as a blocker until a human resolves it.
Before 1.0.0, an optional mode caps breaking at a minor bump.
