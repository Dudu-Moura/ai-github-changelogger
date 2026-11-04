import type { TokenUsage } from "../ports/llm-provider.ts";

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };

/**
 * Sums two usages. One unknown cost makes the total unknown, since a partial
 * sum would understate what was really spent.
 */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimatedCostUsd:
      a.estimatedCostUsd === null || b.estimatedCostUsd === null
        ? null
        : a.estimatedCostUsd + b.estimatedCostUsd,
  };
}
