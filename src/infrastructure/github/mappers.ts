import type { RestEndpointMethodTypes } from "@octokit/rest";
import { GitProviderError } from "../../domain/errors.ts";
import type { ChangeUnit, FileChange, FileStatus } from "../../domain/schemas/change-unit.ts";

type GitHubPullRequest = RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];
export type GitHubPullFile = RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"][number];
export type GitHubCommitListItem = RestEndpointMethodTypes["repos"]["listCommits"]["response"]["data"][number];
type GitHubCommit = RestEndpointMethodTypes["repos"]["getCommit"]["response"]["data"];
type GitHubCommitFile = NonNullable<GitHubCommit["files"]>[number];

export type MergedPullRequest = GitHubPullRequest & { merged_at: string };

export function isMerged(pr: GitHubPullRequest): pr is MergedPullRequest {
  return pr.merged_at !== null;
}

export function isMergeCommit(commit: GitHubCommitListItem): boolean {
  return commit.parents.length > 1;
}

/**
 * Collapses GitHub's seven file statuses into the four the domain cares about.
 */
export function toFileStatus(status: GitHubPullFile["status"]): FileStatus {
  switch (status) {
    case "added":
    case "copied":
      return "added";
    case "removed":
      return "removed";
    case "renamed":
      return "renamed";
    case "modified":
    case "changed":
    case "unchanged":
      return "modified";
  }
}

/**
 * Splits a git commit message into its subject line and the optional body after it.
 */
export function splitCommitMessage(message: string): { title: string; body: string | null } {
  const [subject = "", ...rest] = message.split("\n");
  const body = rest.join("\n").trim();
  return { title: subject.trim(), body: body || null };
}

function toFileChange(file: GitHubPullFile | GitHubCommitFile): FileChange {
  return {
    path: file.filename,
    previousPath: file.previous_filename ?? null,
    status: toFileStatus(file.status),
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch ?? null,
  };
}

export function pullRequestToChangeUnit(pr: MergedPullRequest, files: GitHubPullFile[]): ChangeUnit {
  return {
    kind: "pr",
    ref: `#${pr.number}`,
    url: pr.html_url,
    title: pr.title,
    body: pr.body || null,
    author: pr.user?.login ?? null,
    date: new Date(pr.merged_at),
    files: files.map(toFileChange),
  };
}

export function commitToChangeUnit(commit: GitHubCommit): ChangeUnit {
  const { title, body } = splitCommitMessage(commit.commit.message);
  const date = commit.commit.author?.date ?? commit.commit.committer?.date;
  if (!date) {
    throw new GitProviderError(`GitHub returned commit ${commit.sha} without a date`);
  }

  return {
    kind: "commit",
    ref: commit.sha.slice(0, 7),
    url: commit.html_url,
    title,
    body,
    author: commit.author?.login ?? commit.commit.author?.name ?? null,
    date: new Date(date),
    files: (commit.files ?? []).map(toFileChange),
  };
}
