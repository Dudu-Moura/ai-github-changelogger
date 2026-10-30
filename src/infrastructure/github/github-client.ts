import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";

const ResilientOctokit = Octokit.plugin(retry, throttling);
export type GitHubClient = InstanceType<typeof ResilientOctokit>;

const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_WAIT_SECONDS = 60;

export interface GitHubClientOptions {
  token?: string | undefined;
  fetch?: typeof globalThis.fetch;
}

/**
 * Creates an Octokit client that retries transient failures and waits out
 * short rate limits. Long waits fail fast instead of freezing the CLI.
 */
export function createGitHubClient({ token, fetch }: GitHubClientOptions = {}): GitHubClient {
  return new ResilientOctokit({
    auth: token,
    userAgent: "ai-github-changelogger",
    request: fetch ? { fetch } : undefined,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        const willRetry = retryCount < MAX_RATE_LIMIT_RETRIES && retryAfter <= MAX_WAIT_SECONDS;
        octokit.log.warn(
          `GitHub rate limit hit on ${options.method} ${options.url}. ` +
            (willRetry
              ? `Retrying in ${retryAfter}s.`
              : `Resets in ${Math.ceil(retryAfter / 60)} min. Set GITHUB_TOKEN to get 5000 requests/hour.`),
        );
        return willRetry;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(`GitHub secondary rate limit hit on ${options.method} ${options.url}.`);
        return retryCount < 1 && retryAfter <= MAX_WAIT_SECONDS;
      },
    },
  });
}
