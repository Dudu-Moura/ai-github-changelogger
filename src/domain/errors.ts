import type { TokenUsage } from "./ports/llm-provider.ts";

export class RepositoryNotFoundError extends Error {
  override name = "RepositoryNotFoundError";

  constructor(readonly repo: string) {
    super(`Repository ${repo} not found. Check the name and make sure it is public.`);
  }
}

export class GitProviderError extends Error {
  override name = "GitProviderError";
}

export type LLMOutputFailure = "refusal" | "truncated" | "invalid_output";

/**
 * The model answered, but the answer cannot be used. Affects a single request,
 * and `usage` keeps what was spent so it still counts toward the run's cost.
 */
export class LLMOutputError extends Error {
  override name = "LLMOutputError";

  constructor(
    message: string,
    readonly failure: LLMOutputFailure,
    readonly usage: TokenUsage,
  ) {
    super(message);
  }
}

/**
 * The provider could not serve the request. `fatal` means every other request
 * would fail the same way (bad key, unknown model), so the run should stop.
 */
export class LLMProviderError extends Error {
  override name = "LLMProviderError";

  constructor(
    message: string,
    readonly fatal: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
