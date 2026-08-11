import * as core from "@actions/core";
import * as github from "@actions/github";
import { OctokitClient } from "./github/api.js";
import { handleIssueComment, handlePullRequestMerged, handlePush } from "./github/handlers.js";
import { createProvider } from "./llm/factory.js";

/** The Action entry point: read the event, build the client, dispatch. */
export async function run(): Promise<void> {
  try {
    const token = core.getInput("token") || process.env.GITHUB_TOKEN || "";
    const configPath = core.getInput("config-path") || ".github/onegai.yml";
    const apiKey = core.getInput("provider-api-key") || undefined;

    const octokit = github.getOctokit(token);
    const client = new OctokitClient(octokit, github.context.repo);
    const config = await client.getConfig(configPath);
    const provider = createProvider(config, apiKey);
    const ctx = { configPath, provider };

    const { eventName, payload } = github.context;

    if (
      eventName === "pull_request" &&
      payload.action === "closed" &&
      payload.pull_request?.merged
    ) {
      await handlePullRequestMerged(client, ctx, payload.pull_request.number);
    } else if (
      eventName === "issue_comment" &&
      payload.action === "created" &&
      payload.issue?.pull_request &&
      payload.comment
    ) {
      await handleIssueComment(client, {
        ...ctx,
        prNumber: payload.issue.number,
        commentId: payload.comment.id,
        commentBody: payload.comment.body ?? "",
        commenter: payload.comment.user?.login ?? "",
        association: payload.comment.author_association ?? "NONE",
      });
    } else if (eventName === "push") {
      await handlePush(client, ctx);
    } else {
      core.info(`No handler for event ${eventName} (${payload.action ?? "no action"})`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (process.env.GITHUB_ACTIONS === "true") {
  void run();
}
