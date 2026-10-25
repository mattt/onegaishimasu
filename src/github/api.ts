import type { getOctokit } from "@actions/github";
import { type Config, parseConfig } from "../config.js";
import type { ManifestFile } from "../releasepr/manifests.js";
import type { PullRequestInput } from "../pr.js";

type Octokit = ReturnType<typeof getOctokit>;

export interface ReleasePr {
  number: number;
  body: string;
  comments: string[];
}

export interface MergedPr {
  input: PullRequestInput;
  mergeSha: string;
  /** The head branch name, used to recognize the release PR itself. */
  headRef: string;
}

export interface MergedReleasePr {
  number: number;
  version: string;
  body: string;
  /** The merge commit, which the release tag points at. */
  mergeSha: string;
}

export interface UpsertInput {
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  files: ManifestFile[];
  overflowComments: string[];
}

/**
 * The GitHub operations Onegaishimasu needs.
 * Handlers depend on this interface, not Octokit, so they run without the network.
 */
export interface GitHubClient {
  getConfig(configPath: string): Promise<Config>;
  getDefaultBranch(): Promise<string>;
  getCurrentVersion(manifestPath: string): Promise<string>;
  /** The `version` field of a JSON manifest at a ref, or null when it has none. */
  getManifestVersion(manifestPath: string, ref: string): Promise<string | null>;
  getManifestFiles(paths: string[]): Promise<ManifestFile[]>;
  getChangelog(): Promise<string | null>;
  findReleasePr(branch: string): Promise<ReleasePr | null>;
  getMergedPr(number: number): Promise<MergedPr>;
  getPrDiff(number: number): Promise<string>;
  upsertReleasePr(input: UpsertInput): Promise<number>;
  postComment(prNumber: number, body: string): Promise<void>;
  addReaction(commentId: number, content: "+1" | "-1"): Promise<void>;
  latestTag(): Promise<string | null>;
  listMergedPrNumbersSinceTag(tag: string | null): Promise<number[]>;
  getMergedReleasePr(branch: string): Promise<MergedReleasePr | null>;
  tagExists(version: string): Promise<boolean>;
  tagAndRelease(version: string, notes: string, target: string): Promise<void>;
}

/** Parse the version from a release PR title such as "chore: release 1.2.0". */
export function parseReleaseTitle(title: string): string | null {
  const match = title.match(/release\s+v?(\d+\.\d+\.\d+[^\s]*)/i);
  return match?.[1] ?? null;
}

export interface Repo {
  owner: string;
  repo: string;
}

/** Concrete GitHub client backed by Octokit. */
export class OctokitClient implements GitHubClient {
  constructor(
    private readonly octokit: Octokit,
    private readonly repo: Repo,
  ) {}

  private async getContent(path: string, ref?: string): Promise<string | null> {
    try {
      const res = await this.octokit.rest.repos.getContent({
        ...this.repo,
        path,
        ...(ref ? { ref } : {}),
      });
      const data = res.data as { content?: string; encoding?: string };
      if (typeof data.content === "string") {
        return Buffer.from(data.content, "base64").toString("utf8");
      }
      return null;
    } catch {
      return null;
    }
  }

  async getConfig(configPath: string): Promise<Config> {
    return parseConfig(await this.getContent(configPath));
  }

  async getDefaultBranch(): Promise<string> {
    const res = await this.octokit.rest.repos.get({ ...this.repo });
    return res.data.default_branch;
  }

  async getCurrentVersion(manifestPath: string): Promise<string> {
    const content = await this.getContent(manifestPath);
    if (content) {
      try {
        const version = (JSON.parse(content) as { version?: string }).version;
        if (version) return version;
      } catch {
        /* fall through to tag */
      }
    }
    const tag = await this.latestTag();
    return (tag ?? "0.0.0").replace(/^v/, "");
  }

  async getManifestVersion(manifestPath: string, ref: string): Promise<string | null> {
    const content = await this.getContent(manifestPath, ref);
    if (!content) return null;
    try {
      return (JSON.parse(content) as { version?: string }).version ?? null;
    } catch {
      return null;
    }
  }

  async getManifestFiles(paths: string[]): Promise<ManifestFile[]> {
    const files: ManifestFile[] = [];
    for (const path of paths) {
      const content = await this.getContent(path);
      if (content !== null) files.push({ path, content });
    }
    return files;
  }

  async getChangelog(): Promise<string | null> {
    return this.getContent("CHANGELOG.md");
  }

  async findReleasePr(branch: string): Promise<ReleasePr | null> {
    const prs = await this.octokit.rest.pulls.list({
      ...this.repo,
      state: "open",
      head: `${this.repo.owner}:${branch}`,
    });
    const pr = prs.data[0];
    if (!pr) return null;

    const comments = await this.octokit.rest.issues.listComments({
      ...this.repo,
      issue_number: pr.number,
    });
    return {
      number: pr.number,
      body: pr.body ?? "",
      comments: comments.data.map((c) => c.body ?? ""),
    };
  }

  async getMergedPr(number: number): Promise<MergedPr> {
    const res = await this.octokit.rest.pulls.get({ ...this.repo, pull_number: number });
    const pr = res.data;
    return {
      mergeSha: pr.merge_commit_sha ?? "",
      headRef: pr.head.ref,
      input: {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        author: pr.user?.login ?? "",
        labels: pr.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
        mergeSha: pr.merge_commit_sha ?? undefined,
        contributors: pr.user?.login ? [pr.user.login] : [],
      },
    };
  }

  async getPrDiff(number: number): Promise<string> {
    const res = await this.octokit.rest.pulls.get({
      ...this.repo,
      pull_number: number,
      mediaType: { format: "diff" },
    });
    return res.data as unknown as string;
  }

  async upsertReleasePr(input: UpsertInput): Promise<number> {
    const baseRef = await this.octokit.rest.git.getRef({
      ...this.repo,
      ref: `heads/${input.baseBranch}`,
    });
    const baseSha = baseRef.data.object.sha;
    const baseCommit = await this.octokit.rest.git.getCommit({
      ...this.repo,
      commit_sha: baseSha,
    });

    const tree = await this.octokit.rest.git.createTree({
      ...this.repo,
      base_tree: baseCommit.data.tree.sha,
      tree: input.files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.content,
      })),
    });

    const commit = await this.octokit.rest.git.createCommit({
      ...this.repo,
      message: input.title,
      tree: tree.data.sha,
      parents: [baseSha],
    });

    const ref = `heads/${input.branch}`;
    try {
      await this.octokit.rest.git.updateRef({
        ...this.repo,
        ref,
        sha: commit.data.sha,
        force: true,
      });
    } catch {
      await this.octokit.rest.git.createRef({
        ...this.repo,
        ref: `refs/${ref}`,
        sha: commit.data.sha,
      });
    }

    const existing = await this.octokit.rest.pulls.list({
      ...this.repo,
      state: "open",
      head: `${this.repo.owner}:${input.branch}`,
    });
    const found = existing.data[0];
    if (found) {
      await this.octokit.rest.pulls.update({
        ...this.repo,
        pull_number: found.number,
        title: input.title,
        body: input.body,
      });
      return found.number;
    }
    const created = await this.octokit.rest.pulls.create({
      ...this.repo,
      base: input.baseBranch,
      head: input.branch,
      title: input.title,
      body: input.body,
    });
    return created.data.number;
  }

  async postComment(prNumber: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({
      ...this.repo,
      issue_number: prNumber,
      body,
    });
  }

  async addReaction(commentId: number, content: "+1" | "-1"): Promise<void> {
    await this.octokit.rest.reactions.createForIssueComment({
      ...this.repo,
      comment_id: commentId,
      content,
    });
  }

  async latestTag(): Promise<string | null> {
    const tags = await this.octokit.rest.repos.listTags({ ...this.repo, per_page: 1 });
    return tags.data[0]?.name ?? null;
  }

  async listMergedPrNumbersSinceTag(tag: string | null): Promise<number[]> {
    const base = tag ?? "";
    const head = await this.getDefaultBranch();
    if (!base) return [];
    const compare = await this.octokit.rest.repos.compareCommitsWithBasehead({
      ...this.repo,
      basehead: `${base}...${head}`,
    });
    const numbers = new Set<number>();
    for (const commit of compare.data.commits) {
      const assoc = await this.octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        ...this.repo,
        commit_sha: commit.sha,
      });
      for (const pr of assoc.data) {
        if (pr.merged_at) numbers.add(pr.number);
      }
    }
    return [...numbers].sort((a, b) => a - b);
  }

  async getMergedReleasePr(branch: string): Promise<MergedReleasePr | null> {
    const prs = await this.octokit.rest.pulls.list({
      ...this.repo,
      state: "closed",
      head: `${this.repo.owner}:${branch}`,
      sort: "updated",
      direction: "desc",
      per_page: 5,
    });
    for (const pr of prs.data) {
      if (!pr.merged_at || !pr.merge_commit_sha) continue;
      const version = parseReleaseTitle(pr.title);
      if (version) {
        return { number: pr.number, version, body: pr.body ?? "", mergeSha: pr.merge_commit_sha };
      }
    }
    return null;
  }

  async tagExists(version: string): Promise<boolean> {
    try {
      await this.octokit.rest.git.getRef({ ...this.repo, ref: `tags/v${version}` });
      return true;
    } catch {
      return false;
    }
  }

  async tagAndRelease(version: string, notes: string, target: string): Promise<void> {
    const tag = `v${version}`;
    await this.octokit.rest.repos.createRelease({
      ...this.repo,
      tag_name: tag,
      // Without a target, GitHub tags the default branch's head at run time,
      // which may already include commits merged after the release PR.
      target_commitish: target,
      name: tag,
      body: notes,
    });
  }
}
