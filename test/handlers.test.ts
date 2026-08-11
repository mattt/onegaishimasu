import { describe, expect, it } from "vite-plus/test";
import { parseConfig } from "../src/config.js";
import type { GitHubClient, MergedPr, ReleasePr, UpsertInput } from "../src/github/api.js";
import {
  extractReleaseNotes,
  handleIssueComment,
  handlePullRequestMerged,
  handlePush,
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
  mergedReleasePr: { number: number; version: string; body: string } | null;
  releases: { version: string; notes: string }[];
  existingTags: Set<string>;
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
      return [];
    },
    async getMergedReleasePr() {
      return s.mergedReleasePr;
    },
    async tagExists(version: string) {
      return s.existingTags.has(version);
    },
    async tagAndRelease(version: string, notes: string) {
      s.releases.push({ version, notes });
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
});

describe("handleIssueComment", () => {
  it("applies a verbatim field command from a permitted user", async () => {
    const existing = entry(42, { kind: "feature", summary: "auto" });
    const releaseBody = `body\n<details>\n${serialize(existing)}\n</details>`;
    const { client, state } = makeClient({
      releasePr: { number: 999, body: releaseBody, comments: [] },
      mergedPrs: {
        42: {
          mergeSha: "abc",
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
        body: "## Release 1.3.0\n\n## Release notes\n\n### Features\n\n- thing\n\n<details>\nledger\n</details>",
      },
    });
    await handlePush(client, { configPath: ".github/onegai.yml" });
    expect(state.releases).toEqual([{ version: "1.3.0", notes: "### Features\n\n- thing" }]);
  });

  it("is idempotent when the tag already exists", async () => {
    const { client, state } = makeClient({
      mergedReleasePr: { number: 999, version: "1.3.0", body: "x" },
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
});

// Helper: serialize one entry into a ledger snapshot chunk for fixtures.
function serialize(e: Entry): string {
  return serializeSnapshot([e])[0]!;
}
