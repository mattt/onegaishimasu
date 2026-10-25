import { describe, expect, it } from "vite-plus/test";
import { parseConfig } from "../src/config.js";
import type {
  GitHubClient,
  MergedPr,
  MergedReleasePr,
  ReleasePr,
  UpsertInput,
} from "../src/github/api.js";
import {
  extractReleaseNotes,
  handleIssueComment,
  handlePullRequestMerged,
  handlePush,
  handleRebuild,
  upsertEntry,
} from "../src/github/handlers.js";
import { parseSnapshot, serializeSnapshot } from "../src/ledger/snapshot.js";
import type { CompletionRequest, Provider } from "../src/llm/provider.js";
import { ENTRY_SCHEMA_VERSION, type Entry } from "../src/entry.js";

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

interface FakeState {
  releasePr: ReleasePr | null;
  mergedPrs: Record<number, MergedPr>;
  upserts: UpsertInput[];
  comments: { pr: number; body: string }[];
  reactions: { id: number; content: string }[];
  mergedReleasePr: MergedReleasePr | null;
  releases: { version: string; notes: string; target: string }[];
  existingTags: Set<string>;
  mergedSinceTag: number[];
  manifestVersions: Record<string, string>;
}

function makeClient(state: Partial<FakeState> = {}): { client: GitHubClient; state: FakeState } {
  const s: FakeState = {
    releasePr: null,
    mergedPrs: {},
    upserts: [],
    comments: [],
    reactions: [],
    mergedReleasePr: null,
    releases: [],
    existingTags: new Set(),
    mergedSinceTag: [],
    manifestVersions: {},
    ...state,
  };

  const client: GitHubClient = {
    async getConfig() {
      return parseConfig(null);
    },
    async getDefaultBranch() {
      return "main";
    },
    async getCurrentVersion() {
      return "1.2.0";
    },
    async getManifestVersion(_path: string, ref: string) {
      return s.manifestVersions[ref] ?? null;
    },
    async getManifestFiles() {
      return [
        { path: "package.json", content: JSON.stringify({ name: "x", version: "1.2.0" }, null, 2) },
      ];
    },
    async getChangelog() {
      return null;
    },
    async findReleasePr() {
      return s.releasePr;
    },
    async getMergedPr(number: number) {
      return (
        s.mergedPrs[number] ?? {
          mergeSha: "sha",
          headRef: `feature-${number}`,
          input: { number, title: "feat: default", body: "", author: "octocat", labels: [] },
        }
      );
    },
    async getPrDiff() {
      return "";
    },
    async upsertReleasePr(input: UpsertInput) {
      s.upserts.push(input);
      s.releasePr = { number: 999, body: input.body, comments: [] };
      return 999;
    },
    async postComment(pr: number, body: string) {
      s.comments.push({ pr, body });
    },
    async addReaction(id: number, content: "+1" | "-1") {
      s.reactions.push({ id, content });
    },
    async latestTag() {
      return "v1.2.0";
    },
    async listMergedPrNumbersSinceTag() {
      return s.mergedSinceTag;
    },
    async getMergedReleasePr() {
      return s.mergedReleasePr;
    },
    async tagExists(version: string) {
      return s.existingTags.has(version);
    },
    async tagAndRelease(version: string, notes: string, target: string) {
      s.releases.push({ version, notes, target });
    },
  };

  return { client, state: s };
}

function entry(pr: number, overrides: Partial<Entry> = {}): Entry {
  return {
    schema: ENTRY_SCHEMA_VERSION,
    pr,
    kind: "feature",
    confidence: "high",
    evidence: [],
    summary: `Summary ${pr}`,
    notes: "",
    pinned: [],
    conflict: false,
    firstBatch: false,
    ...overrides,
  };
}

describe("upsertEntry", () => {
  it("replaces an existing entry and keeps order", () => {
    const result = upsertEntry([entry(1), entry(3)], entry(1, { summary: "new" }));
    expect(result.map((e) => e.pr)).toEqual([1, 3]);
    expect(result[0]!.summary).toBe("new");
  });
});

describe("handlePullRequestMerged", () => {
  it("classifies a merged PR and upserts the release PR", async () => {
    const { client, state } = makeClient({
      mergedPrs: {
        42: {
          mergeSha: "abc",
          headRef: "feature",
          input: { number: 42, title: "feat: add retry", body: "", author: "octocat", labels: [] },
        },
      },
    });
    await handlePullRequestMerged(
      client,
      { configPath: ".github/onegai.yml", provider: fakeProvider(featureOutput) },
      42,
    );

    expect(state.upserts).toHaveLength(1);
    const entries = parseSnapshot(state.upserts[0]!.body);
    expect(entries.map((e) => e.pr)).toEqual([42]);
    expect(entries[0]!.kind).toBe("feature");
    expect(state.comments.some((c) => c.pr === 42)).toBe(true);
  });

  it("does not re-classify a PR already in the ledger", async () => {
    const existing = entry(42, { summary: "already classified" });
    const releaseBody = `body\n<details>\n${serialize(existing)}\n</details>`;
    const { client, state } = makeClient({
      releasePr: { number: 999, body: releaseBody, comments: [] },
    });
    await handlePullRequestMerged(
      client,
      { configPath: ".github/onegai.yml", provider: fakeProvider(featureOutput) },
      42,
    );

    const entries = parseSnapshot(state.upserts[0]!.body);
    expect(entries[0]!.summary).toBe("already classified");
    expect(state.comments.some((c) => c.pr === 42)).toBe(false);
  });

  it("ignores the merge of the release PR itself", async () => {
    const { client, state } = makeClient({
      mergedPrs: {
        999: {
          mergeSha: "abc",
          headRef: "onegai--release",
          input: {
            number: 999,
            title: "chore: release 1.3.0",
            body: "",
            author: "github-actions[bot]",
            labels: [],
          },
        },
      },
    });
    await handlePullRequestMerged(
      client,
      { configPath: ".github/onegai.yml", provider: fakeProvider(featureOutput) },
      999,
    );

    expect(state.upserts).toHaveLength(0);
    expect(state.comments).toHaveLength(0);
  });

  it("keeps the ledger when the release PR body has CRLF line endings", async () => {
    const existing = entry(41, { summary: "earlier change" });
    const releaseBody = `body\n<details>\n${serialize(existing)}\n</details>`.replace(
      /\n/g,
      "\r\n",
    );
    const { client, state } = makeClient({
      releasePr: { number: 999, body: releaseBody, comments: [] },
    });
    await handlePullRequestMerged(
      client,
      { configPath: ".github/onegai.yml", provider: fakeProvider(featureOutput) },
      42,
    );

    const entries = parseSnapshot(state.upserts[0]!.body);
    expect(entries.map((e) => e.pr)).toEqual([41, 42]);
  });
});

describe("release cycles", () => {
  const ctx = { configPath: ".github/onegai.yml", provider: fakeProvider(featureOutput) };

  it("marks the first cycle's backlog first-batch and comments on the merged PR", async () => {
    const { client, state } = makeClient({ mergedSinceTag: [41, 42] });
    await handlePullRequestMerged(client, ctx, 42);

    const entries = parseSnapshot(state.upserts[0]!.body);
    expect(entries.map((e) => e.pr)).toEqual([41, 42]);
    expect(entries.every((e) => e.firstBatch)).toBe(true);
    expect(state.comments.filter((c) => c.pr === 42)).toHaveLength(1);
    expect(state.comments[0]!.body).toContain("#999");
  });

  it("does not mark later cycles first-batch", async () => {
    const { client, state } = makeClient({
      mergedSinceTag: [42],
      mergedReleasePr: { number: 18, version: "0.1.0", body: "x", mergeSha: "rel" },
    });
    await handlePullRequestMerged(client, ctx, 42);

    const entries = parseSnapshot(state.upserts[0]!.body);
    expect(entries.map((e) => e.firstBatch)).toEqual([false]);
    expect(state.comments.some((c) => c.pr === 42)).toBe(true);
  });

  it("rebuilds every entry and keeps human corrections", async () => {
    const corrected = entry(42, { kind: "fix", summary: "Human summary", pinned: ["summary"] });
    const releaseBody = `body\n<details>\n${serialize(corrected)}\n</details>`;
    const { client, state } = makeClient({
      mergedSinceTag: [41, 42],
      releasePr: { number: 999, body: releaseBody, comments: [] },
    });
    await handleRebuild(client, ctx);

    const entries = parseSnapshot(state.upserts[0]!.body);
    expect(entries.map((e) => e.pr)).toEqual([41, 42]);
    const rebuilt = entries.find((e) => e.pr === 42)!;
    expect(rebuilt.summary).toBe("Human summary");
    expect(rebuilt.kind).toBe("feature");
  });

  it("does nothing on a rebuild with no merges and no release PR", async () => {
    const warnings: string[] = [];
    const { client, state } = makeClient();
    await handleRebuild(client, { ...ctx, warn: (m) => warnings.push(m) });
    expect(state.upserts).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("reports a provider failure", async () => {
    const warnings: string[] = [];
    const failing: Provider = {
      model: "fake-1",
      async complete(): Promise<string> {
        throw new Error("401 invalid x-api-key");
      },
    };
    const { client } = makeClient();
    await handlePullRequestMerged(
      client,
      { configPath: ".github/onegai.yml", provider: failing, warn: (m) => warnings.push(m) },
      42,
    );
    expect(warnings.some((w) => w.includes("PR #42") && w.includes("401"))).toBe(true);
  });
});

describe("handleIssueComment", () => {
  it("explains an invalid command", async () => {
    const { client, state } = makeClient({
      mergedPrs: {
        42: {
          mergeSha: "abc",
          headRef: "feature",
          input: { number: 42, title: "feat: x", body: "", author: "octocat", labels: [] },
        },
      },
    });
    await handleIssueComment(client, {
      configPath: ".github/onegai.yml",
      prNumber: 42,
      commentId: 7,
      commentBody: "/onegai kind: feat",
      commenter: "octocat",
      association: "NONE",
    });
    expect(state.reactions).toContainEqual({ id: 7, content: "-1" });
    expect(state.comments[0]!.body).toContain("not a valid kind: feat");
  });

  it("applies a verbatim field command from a permitted user", async () => {
    const existing = entry(42, { kind: "feature", summary: "auto" });
    const releaseBody = `body\n<details>\n${serialize(existing)}\n</details>`;
    const { client, state } = makeClient({
      releasePr: { number: 999, body: releaseBody, comments: [] },
      mergedPrs: {
        42: {
          mergeSha: "abc",
          headRef: "feature",
          input: { number: 42, title: "feat: x", body: "", author: "octocat", labels: [] },
        },
      },
    });

    await handleIssueComment(client, {
      configPath: ".github/onegai.yml",
      prNumber: 42,
      commentId: 7,
      commentBody: "/onegai kind: fix",
      commenter: "maintainer",
      association: "MEMBER",
    });

    expect(state.reactions).toContainEqual({ id: 7, content: "+1" });
    const entries = parseSnapshot(state.upserts[0]!.body);
    expect(entries[0]!.kind).toBe("fix");
    expect(entries[0]!.pinned).toContain("kind");
  });

  it("rejects a command from an unauthorized user", async () => {
    const existing = entry(42);
    const releaseBody = `body\n<details>\n${serialize(existing)}\n</details>`;
    const { client, state } = makeClient({
      releasePr: { number: 999, body: releaseBody, comments: [] },
      mergedPrs: {
        42: {
          mergeSha: "abc",
          headRef: "feature",
          input: { number: 42, title: "feat: x", body: "", author: "octocat", labels: [] },
        },
      },
    });

    await handleIssueComment(client, {
      configPath: ".github/onegai.yml",
      prNumber: 42,
      commentId: 7,
      commentBody: "/onegai kind: fix",
      commenter: "stranger",
      association: "NONE",
    });

    expect(state.reactions).toContainEqual({ id: 7, content: "-1" });
    expect(state.upserts).toHaveLength(0);
  });

  it("ignores non-command comments", async () => {
    const { client, state } = makeClient();
    await handleIssueComment(client, {
      configPath: ".github/onegai.yml",
      prNumber: 42,
      commentId: 7,
      commentBody: "just chatting",
      commenter: "someone",
      association: "MEMBER",
    });
    expect(state.reactions).toHaveLength(0);
    expect(state.upserts).toHaveLength(0);
  });
});

describe("handlePush", () => {
  it("tags and releases a merged release PR", async () => {
    const { client, state } = makeClient({
      mergedReleasePr: {
        number: 999,
        version: "1.3.0",
        mergeSha: "def",
        body: "## Release 1.3.0\n\n## Release notes\n\n### Features\n\n- thing\n\n<details>\nledger\n</details>",
      },
    });
    await handlePush(client, { configPath: ".github/onegai.yml" });
    expect(state.releases).toEqual([
      { version: "1.3.0", notes: "### Features\n\n- thing", target: "def" },
    ]);
  });

  it("tags the version in the merged manifest, not an edited title", async () => {
    const { client, state } = makeClient({
      mergedReleasePr: { number: 999, version: "0.2.0", body: "x", mergeSha: "def" },
      manifestVersions: { def: "0.1.0" },
    });
    await handlePush(client, { configPath: ".github/onegai.yml" });
    expect(state.releases.map((r) => r.version)).toEqual(["0.1.0"]);
  });

  it("releases a merged release PR whose title no longer names a version", async () => {
    const { client, state } = makeClient({
      mergedReleasePr: { number: 999, version: null, body: "x", mergeSha: "def" },
      manifestVersions: { def: "0.1.0" },
    });
    await handlePush(client, { configPath: ".github/onegai.yml" });
    expect(state.releases.map((r) => r.version)).toEqual(["0.1.0"]);
  });

  it("is idempotent when the tag already exists", async () => {
    const { client, state } = makeClient({
      mergedReleasePr: { number: 999, version: "1.3.0", body: "x", mergeSha: "def" },
      existingTags: new Set(["1.3.0"]),
    });
    await handlePush(client, { configPath: ".github/onegai.yml" });
    expect(state.releases).toHaveLength(0);
  });
});

describe("extractReleaseNotes", () => {
  it("pulls the notes section out of a body", () => {
    const body =
      "## Release 1.0.0\n\n## Release notes\n\n### Features\n\n- a\n\n<details>\nledger\n</details>";
    expect(extractReleaseNotes(body)).toBe("### Features\n\n- a");
  });

  it("drops the section markers", () => {
    const body = [
      "## Release notes",
      "",
      "<!-- onegai:section id=fixes hash=abc123 -->",
      "### Bug fixes",
      "",
      "- b",
      "<!-- /onegai:section id=fixes -->",
      "",
      "<details>",
    ].join("\n");
    expect(extractReleaseNotes(body)).toBe("### Bug fixes\n\n- b");
  });
});

// Helper: serialize one entry into a ledger snapshot chunk for fixtures.
function serialize(e: Entry): string {
  return serializeSnapshot([e])[0]!;
}
