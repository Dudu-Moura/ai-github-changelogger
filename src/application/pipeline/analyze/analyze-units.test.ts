import { describe, expect, it } from "vitest";
import { LLMOutputError, LLMProviderError } from "../../../domain/errors.ts";
import type { LLMProvider, TokenUsage } from "../../../domain/ports/llm-provider.ts";
import type { UnitAnalysis } from "../../../domain/schemas/unit-analysis.ts";
import type { PreparedUnit } from "../prepare/prepare-unit.ts";
import { analyzeUnits } from "./analyze-units.ts";
import { ANALYZE_SYSTEM_PROMPT } from "./prompt.ts";

const USAGE: TokenUsage = { inputTokens: 100, outputTokens: 10, estimatedCostUsd: 0.5 };

const ANALYSIS: UnitAnalysis = {
  category: "fix",
  impact: "medium",
  title: "Fix login",
  description: "Login no longer fails.",
  isBreaking: false,
  breakingReason: null,
  mentionedFiles: ["src/auth.ts"],
  messageMatchesDiff: true,
  mismatchReason: null,
  confidence: 0.9,
};

function unit(ref: string): PreparedUnit {
  return {
    unit: {
      kind: "pr",
      ref,
      url: "https://github.com/acme/app/pull/1",
      title: `Change ${ref}`,
      body: null,
      author: "dev",
      date: new Date("2026-10-01T00:00:00Z"),
      files: [],
    },
    files: [
      { path: "src/auth.ts", previousPath: null, status: "modified", additions: 1, deletions: 1, truncated: false, hunks: [] },
    ],
    omittedFiles: [],
    truncated: false,
    estimatedTokens: 100,
  };
}

function fakeLLM(handler: (prompt: string) => Promise<unknown> | unknown = () => ANALYSIS) {
  const calls: Array<{ model: string; system: string; prompt: string }> = [];

  const llm: LLMProvider = {
    name: "fake",
    async generateStructured(request) {
      calls.push(request);
      const data = await handler(request.prompt);
      return { data: request.schema.parse(data), model: "served-model", usage: USAGE };
    },
  };

  return { llm, calls };
}

const options = { model: "map-model", language: "pt-BR", concurrency: 2 };

describe("analyzeUnits", () => {
  it("analisa cada unidade e soma o uso", async () => {
    const { llm, calls } = fakeLLM();

    const outcome = await analyzeUnits([unit("#1"), unit("#2")], { ...options, llm });

    expect(outcome.analyzed.map((item) => item.prepared.unit.ref)).toEqual(["#1", "#2"]);
    expect(outcome.analyzed[0]).toMatchObject({ analysis: ANALYSIS, model: "served-model" });
    expect(outcome.skipped).toEqual([]);
    expect(outcome.usage).toEqual({ inputTokens: 200, outputTokens: 20, estimatedCostUsd: 1 });
    expect(calls[0]).toMatchObject({ model: "map-model", system: ANALYZE_SYSTEM_PROMPT });
    expect(calls[0]?.prompt).toContain("in pt-BR");
  });

  it("não chama o LLM quando não há unidades", async () => {
    const { llm, calls } = fakeLLM();

    await expect(analyzeUnits([], { ...options, llm })).resolves.toEqual({
      analyzed: [],
      skipped: [],
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    });
    expect(calls).toEqual([]);
  });

  it("respeita o limite de concorrência e mantém a ordem de entrada", async () => {
    let running = 0;
    let peak = 0;
    const { llm } = fakeLLM(async (prompt) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, prompt.includes("#1") ? 20 : 1));
      running--;
      return ANALYSIS;
    });

    const outcome = await analyzeUnits(["#1", "#2", "#3", "#4", "#5"].map(unit), { ...options, llm });

    expect(peak).toBe(2);
    expect(outcome.analyzed.map((item) => item.prepared.unit.ref)).toEqual(["#1", "#2", "#3", "#4", "#5"]);
  });
});

describe("analyzeUnits — limpeza da análise", () => {
  it("remove arquivos que não existem no diff", async () => {
    const { llm } = fakeLLM(() => ({ ...ANALYSIS, mentionedFiles: ["src/auth.ts", "src/invented.ts"] }));

    const { analyzed } = await analyzeUnits([unit("#1")], { ...options, llm });

    expect(analyzed[0]?.analysis.mentionedFiles).toEqual(["src/auth.ts"]);
  });

  it("descarta motivos que contradizem a própria flag", async () => {
    const { llm } = fakeLLM(() => ({ ...ANALYSIS, breakingReason: "no reason", mismatchReason: "no reason" }));

    const { analyzed } = await analyzeUnits([unit("#1")], { ...options, llm });

    expect(analyzed[0]?.analysis).toMatchObject({ breakingReason: null, mismatchReason: null });
  });

  it("mantém os motivos quando as flags os justificam", async () => {
    const flagged = { ...ANALYSIS, isBreaking: true, breakingReason: "API removed", messageMatchesDiff: false, mismatchReason: "Says fix" };
    const { llm } = fakeLLM(() => flagged);

    const { analyzed } = await analyzeUnits([unit("#1")], { ...options, llm });

    expect(analyzed[0]?.analysis).toMatchObject({ breakingReason: "API removed", mismatchReason: "Says fix" });
  });
});

describe("analyzeUnits — falhas", () => {
  it("pula a unidade com saída inutilizável, conta o gasto e segue com as outras", async () => {
    const { llm } = fakeLLM((prompt) => {
      if (prompt.includes("#2")) throw new LLMOutputError("Model refused the request (category: cyber)", "refusal", USAGE);
      return ANALYSIS;
    });

    const outcome = await analyzeUnits([unit("#1"), unit("#2"), unit("#3")], { ...options, llm });

    expect(outcome.analyzed.map((item) => item.prepared.unit.ref)).toEqual(["#1", "#3"]);
    expect(outcome.skipped).toEqual([{ ref: "#2", reason: "Analysis failed: Model refused the request (category: cyber)" }]);
    expect(outcome.usage.inputTokens).toBe(300);
  });

  it("pula a unidade em erro temporário do provider, sem gasto", async () => {
    const { llm } = fakeLLM((prompt) => {
      if (prompt.includes("#2")) throw new LLMProviderError("Claude rate limit reached.", false);
      return ANALYSIS;
    });

    const outcome = await analyzeUnits([unit("#1"), unit("#2")], { ...options, llm });

    expect(outcome.skipped).toEqual([{ ref: "#2", reason: "Analysis failed: Claude rate limit reached." }]);
    expect(outcome.usage.inputTokens).toBe(100);
  });

  it("interrompe no erro fatal e não chama o LLM para o que estava na fila", async () => {
    const fatal = new LLMProviderError("Claude rejected the credentials.", true);
    const { llm, calls } = fakeLLM(() => {
      throw fatal;
    });

    await expect(analyzeUnits(["#1", "#2", "#3", "#4"].map(unit), { ...options, llm, concurrency: 1 })).rejects.toBe(fatal);
    expect(calls).toHaveLength(1);
  });

  it("propaga erros inesperados em vez de escondê-los como unidade pulada", async () => {
    const bug = new TypeError("bug");
    const { llm } = fakeLLM(() => {
      throw bug;
    });

    await expect(analyzeUnits([unit("#1")], { ...options, llm })).rejects.toBe(bug);
  });
});
