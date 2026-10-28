import type { ChangeUnit } from "../schemas/change-unit.ts";
import type { ChangelogRequest } from "../schemas/changelog-request.ts";

export type ChangeQuery = Pick<ChangelogRequest, "repo" | "range" | "source">;

export interface GitProvider {
  /**
   * Fetches the PRs or commits matching the query, newest first,
   * each one with its changed files and patches.
   */
  fetchChangeUnits(query: ChangeQuery): Promise<ChangeUnit[]>;
}
