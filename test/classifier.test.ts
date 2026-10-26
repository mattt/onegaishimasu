import { describe, expect, it } from "vite-plus/test";
import { classify } from "../src/classify/classifier.js";
import type { CompletionRequest, Provider } from "../src/llm/provider.js";
import type { PullRequestInput } from "../src/pr.js";

function pr(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    number: 1,
    title: "feat: add thing",
    body: "",
    author: "octocat",
    labels: [],
    ...overrides,
  };
}

function fakeProvider(output: string): Provider {
  return {
    model: "fake-1",
    async complete(_r: CompletionRequest): Promise<string> {
      return output;
    },
  };
}

const featureOutput = JSON.stringify({
  kind: "feature",
  summary: "Add a thing",
  notes: "You can now do the thing.",
});

describe("classifier short-circuits", () => {
  it("keeps a breaking label and a Release-As footer on a dependency PR", async () => {
    const entry = await classify(
      pr({
        author: "dependabot[bot]",
        title: "Bump lodash from 1 to 2",
        labels: ["breaking-change"],
        body: "Release-As: 2.0.0",
      }),
      { provider: fakeProvider("should not be used") },
    );
    expect(entry.kind).toBe("breaking");
    expect(entry.evidence.some((e) => e.source === "release-as")).toBe(true);
    expect(entry.provenance).toBeUndefined();
  });

  it("does not flag a conflict for a chore(deps) title", async () => {
    const entry = await classify(
      pr({ author: "dependabot[bot]", title: "chore(deps): bump lodash from 1 to 2" }),
    );
    expect(entry.kind).toBe("deps");
    expect(entry.conflict).toBe(false);
  });

  it("classifies dependabot PRs as deps without inference", async () => {
    const entry = await classify(
      pr({ author: "dependabot[bot]", title: "Bump lodash from 1 to 2" }),
      { provider: fakeProvider("should not be used") },
    );
    expect(entry.kind).toBe("deps");
    expect(entry.evidence.some((e) => e.source === "bot")).toBe(true);
    expect(entry.evidence.some((e) => e.source === "model")).toBe(false);
  });

  it("cancels a revert of an unreleased PR as internal", async () => {
    const entry = await classify(
      pr({ number: 10, title: 'Revert "feat: x"', body: "Reverts #5" }),
      { unreleasedPrs: new Set([5]) },
    );
    expect(entry.kind).toBe("internal");
  });

  it("treats a revert of released work as an ordinary change", async () => {
    const entry = await classify(
      pr({ number: 10, title: 'Revert "feat: x"', body: "Reverts #5" }),
      { unreleasedPrs: new Set([99]), provider: fakeProvider(featureOutput) },
    );
    expect(entry.kind).not.toBe("internal");
  });
});

describe("signals beat the model", () => {
  it("uses the conventional-commit kind even when the model disagrees", async () => {
    const modelSaysBreaking = JSON.stringify({
      kind: "breaking",
      summary: "s",
      notes: "n",
    });
    const entry = await classify(pr({ title: "fix: small patch" }), {
      provider: fakeProvider(modelSaysBreaking),
    });
    expect(entry.kind).toBe("fix");
    expect(entry.conflict).toBe(true);
    expect(entry.confidence).toBe("high");
  });

  it("takes prose from the model while keeping the explicit kind", async () => {
    const entry = await classify(pr({ title: "feat: add retry" }), {
      provider: fakeProvider(featureOutput),
    });
    expect(entry.kind).toBe("feature");
    expect(entry.summary).toBe("Add a thing");
    expect(entry.notes).toBe("You can now do the thing.");
  });
});

describe("model fills gaps", () => {
  it("uses the model kind when no explicit signal exists", async () => {
    const entry = await classify(pr({ title: "Make retries better" }), {
      provider: fakeProvider(featureOutput),
    });
    expect(entry.kind).toBe("feature");
    expect(entry.confidence).toBe("medium");
  });

  it("caps model-only confidence at medium", async () => {
    const entry = await classify(pr({ title: "random title" }), {
      provider: fakeProvider(featureOutput),
    });
    expect(entry.confidence).toBe("medium");
  });
});

describe("honest failure", () => {
  it("emits unknown at low confidence when schema fails twice and no signal exists", async () => {
    const entry = await classify(pr({ title: "random title" }), {
      provider: fakeProvider("not json at all"),
    });
    expect(entry.kind).toBe("unknown");
    expect(entry.confidence).toBe("low");
    expect(entry.provenance?.model).toBe("fake-1");
  });

  it("emits unknown when the provider throws and no signal exists", async () => {
    const entry = await classify(pr({ title: "random title" }), {
      provider: {
        model: "fake-1",
        async complete(): Promise<string> {
          throw new Error("429 Too Many Requests");
        },
      },
    });
    expect(entry.kind).toBe("unknown");
    expect(entry.confidence).toBe("low");
  });

  it("falls back to the explicit kind when the model fails", async () => {
    const entry = await classify(pr({ title: "fix: patch" }), {
      provider: fakeProvider("garbage"),
    });
    expect(entry.kind).toBe("fix");
  });
});

describe("provenance and no-provider", () => {
  it("records model and prompt version when a provider runs", async () => {
    const entry = await classify(pr({ title: "feat: x" }), {
      provider: fakeProvider(featureOutput),
    });
    expect(entry.provenance).toEqual({ model: "fake-1", promptVersion: "2" });
  });

  it("works deterministically with no provider at all", async () => {
    const entry = await classify(pr({ title: "feat: add retry" }));
    expect(entry.kind).toBe("feature");
    expect(entry.provenance).toBeUndefined();
    expect(entry.summary).toBe("feat: add retry");
  });
});
