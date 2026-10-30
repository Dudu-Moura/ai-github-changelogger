import pLimit from "p-limit";
import { GitProviderError, RepositoryNotFoundError } from "../../domain/errors.ts";
import type { ChangeQuery, GitProvider } from "../../domain/ports/git-provider.ts";
import { changeUnitSchema, type ChangeUnit } from "../../domain/schemas/change-unit.ts";
import type { ChangeRange, RepoRef } from "../../domain/schemas/changelog-request.ts";
import type { GitHubClient } from "./github-client.ts";
import {
  commitToChangeUnit,
  isMergeCommit,
  isMerged,
  pullRequestToChangeUnit,
  type GitHubCommitListItem,
  type MergedPullRequest,
} from "./mappers.ts";

const PER_PAGE = 100;
const MAX_LIST_PAGES = 10;

export interface GitHubGitProviderOptions {
  concurrency?: number;
}

export class GitHubGitProvider implements GitProvider {
  readonly #client: GitHubClient;
  readonly #concurrency: number;

  constructor(client: GitHubClient, { concurrency = 4 }: GitHubGitProviderOptions = {}) {
    this.#client = client;
    this.#concurrency = concurrency;
  }

  async fetchChangeUnits(query: ChangeQuery): Promise<ChangeUnit[]> {
    try {
      const units =
        query.source === "pr" ? await this.#fetchPullRequests(query) : await this.#fetchCommits(query);
      return units.map((unit) => changeUnitSchema.parse(unit));
    } catch (error) {
      throw toDomainError(error, query.repo);
    }
  }

  async #fetchPullRequests({ repo, range }: ChangeQuery): Promise<ChangeUnit[]> {
    const pullRequests = await this.#listMergedPullRequests(repo, range);
    const limit = pLimit(this.#concurrency);

    return Promise.all(
      pullRequests.map((pr) =>
        limit(async () => {
          const files = await this.#client.paginate(this.#client.pulls.listFiles, {
            owner: repo.owner,
            repo: repo.name,
            pull_number: pr.number,
            per_page: PER_PAGE,
          });
          return pullRequestToChangeUnit(pr, files);
        }),
      ),
    );
  }

  /**
   * GitHub cannot sort PRs by merge date, so we list closed PRs by `updated_at`
   * (newest first) and stop as soon as no later page could hold a relevant PR.
   * This works because a PR is always updated when merged: merged_at <= updated_at.
   */
  async #listMergedPullRequests(repo: RepoRef, range: ChangeRange): Promise<MergedPullRequest[]> {
    const collected: MergedPullRequest[] = [];

    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const { data } = await this.#client.pulls.list({
        owner: repo.owner,
        repo: repo.name,
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: PER_PAGE,
        page,
      });

      collected.push(
        ...data.filter(isMerged).filter((pr) => isWithinRange(new Date(pr.merged_at), range)),
      );

      const oldestUpdatedAt = data.at(-1)?.updated_at;
      if (data.length < PER_PAGE || !oldestUpdatedAt) break;
      if (canStopPaging(new Date(oldestUpdatedAt), collected, range)) break;

      if (page === MAX_LIST_PAGES) {
        this.#client.log.warn(
          `Reached the limit of ${MAX_LIST_PAGES * PER_PAGE} listed PRs; older PRs may have been left out.`,
        );
      }
    }

    collected.sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at));
    return range.type === "last" ? collected.slice(0, range.count) : collected;
  }

  async #fetchCommits({ repo, range }: ChangeQuery): Promise<ChangeUnit[]> {
    const commits = await this.#listCommits(repo, range);
    const limit = pLimit(this.#concurrency);

    return Promise.all(
      commits.map((commit) =>
        limit(async () => {
          const { data } = await this.#client.repos.getCommit({
            owner: repo.owner,
            repo: repo.name,
            ref: commit.sha,
          });
          return commitToChangeUnit(data);
        }),
      ),
    );
  }

  /**
   * Lists commits on the default branch, skipping merge commits: their diff
   * repeats changes already present in the commits they merge.
   */
  async #listCommits(repo: RepoRef, range: ChangeRange): Promise<GitHubCommitListItem[]> {
    const collected: GitHubCommitListItem[] = [];
    const dateFilter =
      range.type === "date"
        ? { since: range.since.toISOString(), ...(range.until && { until: range.until.toISOString() }) }
        : {};

    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const { data } = await this.#client.repos.listCommits({
        owner: repo.owner,
        repo: repo.name,
        per_page: PER_PAGE,
        page,
        ...dateFilter,
      });

      collected.push(...data.filter((commit) => !isMergeCommit(commit)));

      if (data.length < PER_PAGE) break;
      if (range.type === "last" && collected.length >= range.count) break;
    }

    return range.type === "last" ? collected.slice(0, range.count) : collected;
  }
}

function isWithinRange(date: Date, range: ChangeRange): boolean {
  if (range.type === "last") return true;
  return date >= range.since && (!range.until || date <= range.until);
}

/**
 * Every PR on later pages has updated_at <= oldestUpdatedAt, and therefore
 * merged_at <= oldestUpdatedAt. Paging can stop once that bound proves
 * none of them could enter the result.
 */
function canStopPaging(oldestUpdatedAt: Date, collected: MergedPullRequest[], range: ChangeRange): boolean {
  if (range.type === "date") {
    return oldestUpdatedAt < range.since;
  }

  if (collected.length < range.count) return false;

  const mergeDatesDesc = collected.map((pr) => Date.parse(pr.merged_at)).sort((a, b) => b - a);
  const nthNewest = mergeDatesDesc[range.count - 1];
  return nthNewest !== undefined && nthNewest >= oldestUpdatedAt.getTime();
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return undefined;
}

function toDomainError(error: unknown, repo: RepoRef): Error {
  const fullName = `${repo.owner}/${repo.name}`;

  if (error instanceof GitProviderError) return error;
  if (getHttpStatus(error) === 404) return new RepositoryNotFoundError(fullName);

  const reason = error instanceof Error ? error.message : String(error);
  return new GitProviderError(`Failed to query ${fullName} on GitHub: ${reason}`, { cause: error });
}
