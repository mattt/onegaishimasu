import { describe, expect, it } from "vite-plus/test";
import type { PullRequestInput } from "../src/pr.js";
import { botSignals } from "../src/signals/bots.js";
import { conventionalSignals } from "../src/signals/conventional.js";
import { DEFAULT_LABEL_MAP, labelSignals } from "../src/signals/labels.js";
import { revertSignals } from "../src/signals/reverts.js";

function pr(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    number: 1,
    title: "chore: tidy",
    body: "",
    author: "octocat",
    labels: [],
    ...overrides,
  };
}

describe("conventional commits", () => {
  it("maps feat to feature", () => {
    const r = conventionalSignals(pr({ title: "feat(client): add retry" }));
    expect(r.impliedKind).toBe("feature");
    expect(r.evidence[0]).toMatchObject({
      source: "conventional-commit",
      impliedKind: "feature",
    });
  });

  it("treats the bang marker as breaking", () => {
    const r = conventionalSignals(pr({ title: "feat!: drop legacy api" }));
    expect(r.impliedKind).toBe("breaking");
  });

  it("treats a BREAKING CHANGE footer as breaking", () => {
    const r = conventionalSignals(
      pr({ title: "refactor: rework client", body: "BREAKING CHANGE: renamed options" }),
    );
    expect(r.impliedKind).toBe("breaking");
  });

  it("maps chore and ci to internal", () => {
    expect(conventionalSignals(pr({ title: "chore: deps" })).impliedKind).toBe("internal");
    expect(conventionalSignals(pr({ title: "ci: fix workflow" })).impliedKind).toBe("internal");
  });

  it("ignores a non-conventional title", () => {
    const r = conventionalSignals(pr({ title: "Make things better" }));
    expect(r.impliedKind).toBeUndefined();
    expect(r.evidence).toEqual([]);
  });

  it("extracts a Release-As footer", () => {
    const r = conventionalSignals(pr({ title: "fix: patch", body: "Release-As: 2.0.0" }));
    expect(r.releaseAs).toBe("2.0.0");
    expect(r.evidence.some((e) => e.source === "release-as")).toBe(true);
  });
});

describe("labels", () => {
  it("maps configured labels to kinds", () => {
    const r = labelSignals(pr({ labels: ["enhancement", "breaking"] }), DEFAULT_LABEL_MAP);
    expect(r.impliedKinds.sort()).toEqual(["breaking", "feature"]);
  });

  it("ignores unmapped labels", () => {
    const r = labelSignals(pr({ labels: ["needs-triage"] }));
    expect(r.evidence).toEqual([]);
  });
});

describe("bots", () => {
  it("detects dependabot by author", () => {
    const r = botSignals(pr({ author: "dependabot[bot]", title: "Bump lodash from 1 to 2" }));
    expect(r.isBot).toBe(true);
    expect(r.evidence[0]?.impliedKind).toBe("deps");
  });

  it("detects a deps title from a human author", () => {
    const r = botSignals(pr({ title: "chore(deps): bump vite" }));
    expect(r.isBot).toBe(true);
  });

  it("leaves ordinary PRs alone", () => {
    expect(botSignals(pr({ title: "feat: add thing" })).isBot).toBe(false);
  });
});

describe("reverts", () => {
  it("detects a revert and its target from the body", () => {
    const r = revertSignals(pr({ title: 'Revert "feat: add retry"', body: "Reverts #482" }));
    expect(r.isRevert).toBe(true);
    expect(r.targetPr).toBe(482);
  });

  it("detects a revert without a resolvable target", () => {
    const r = revertSignals(pr({ title: 'Revert "some change"' }));
    expect(r.isRevert).toBe(true);
    expect(r.targetPr).toBeUndefined();
  });

  it("leaves ordinary PRs alone", () => {
    expect(revertSignals(pr({ title: "feat: add thing" })).isRevert).toBe(false);
  });
});
