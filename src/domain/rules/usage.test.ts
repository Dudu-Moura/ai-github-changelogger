import { describe, expect, it } from "vitest";
import { addUsage, ZERO_USAGE } from "./usage.ts";

describe("addUsage", () => {
  it("soma tokens e custo", () => {
    const usage = { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.5 };

    expect(addUsage(usage, usage)).toEqual({ inputTokens: 20, outputTokens: 10, estimatedCostUsd: 1 });
    expect(addUsage(ZERO_USAGE, usage)).toEqual(usage);
  });

  it("torna o custo desconhecido quando uma das partes é desconhecida", () => {
    const unknown = { inputTokens: 10, outputTokens: 5, estimatedCostUsd: null };

    expect(addUsage(ZERO_USAGE, unknown)).toEqual(unknown);
  });
});
