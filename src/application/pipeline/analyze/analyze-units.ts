import pLimit from "p-limit";
import { LLMOutputError, LLMProviderError } from "../../../domain/errors.ts";
import type { LLMProvider, TokenUsage } from "../../../domain/ports/llm-provider.ts";
import { addUsage, ZERO_USAGE } from "../../../domain/rules/usage.ts";
import { unitAnalysisSchema, type UnitAnalysis } from "../../../domain/schemas/unit-analysis.ts";
import type { PreparedUnit, SkippedUnit } from "../prepare/prepare-unit.ts";
import { ANALYZE_SYSTEM_PROMPT, buildAnalyzePrompt } from "./prompt.ts";

export interface AnalyzeOptions {
  llm: LLMProvider;
  model: string;
  language: string;
  concurrency: number;
}

export interface AnalyzedUnit {
  prepared: PreparedUnit;
  analysis: UnitAnalysis;
  model: string;
}

export interface AnalyzeOutcome {
  analyzed: AnalyzedUnit[];
  skipped: SkippedUnit[];
  usage: TokenUsage;
}

type UnitResult =
  | { status: "analyzed"; analyzed: AnalyzedUnit; usage: TokenUsage }
  | { status: "skipped"; skipped: SkippedUnit; usage: TokenUsage };

/**
 * Analyzes every unit, a few at a time, keeping the input order. A unit that
 * fails becomes a skipped entry and the others go on. A fatal provider error
 * stops the run, and the queue is cleared so no more calls are paid for.
 */
export async function analyzeUnits(units: PreparedUnit[], options: AnalyzeOptions): Promise<AnalyzeOutcome> {
  const limit = pLimit(options.concurrency);

  const results = await Promise.all(
    units.map((unit) =>
      limit(async () => {
        try {
          return await analyzeUnit(unit, options);
        } catch (error) {
          limit.clearQueue();
          throw error;
        }
      }),
    ),
  );

  return {
    analyzed: results.flatMap((result) => (result.status === "analyzed" ? [result.analyzed] : [])),
    skipped: results.flatMap((result) => (result.status === "skipped" ? [result.skipped] : [])),
    usage: results.map((result) => result.usage).reduce(addUsage, ZERO_USAGE),
  };
}

async function analyzeUnit(prepared: PreparedUnit, { llm, model, language }: AnalyzeOptions): Promise<UnitResult> {
  const { ref } = prepared.unit;

  try {
    const response = await llm.generateStructured({
      model,
      system: ANALYZE_SYSTEM_PROMPT,
      prompt: buildAnalyzePrompt(prepared, language),
      schema: unitAnalysisSchema,
    });

    return {
      status: "analyzed",
      analyzed: { prepared, analysis: normalizeAnalysis(response.data, prepared), model: response.model },
      usage: response.usage,
    };
  } catch (error) {
    if (error instanceof LLMOutputError) {
      return { status: "skipped", skipped: { ref, reason: `Analysis failed: ${error.message}` }, usage: error.usage };
    }
    if (error instanceof LLMProviderError && !error.fatal) {
      return { status: "skipped", skipped: { ref, reason: `Analysis failed: ${error.message}` }, usage: ZERO_USAGE };
    }
    throw error;
  }
}

/**
 * Enforces what the schema cannot express: file paths must exist in the diff the
 * model saw, and a reason only makes sense when its flag calls for one.
 */
function normalizeAnalysis(analysis: UnitAnalysis, { files }: PreparedUnit): UnitAnalysis {
  const knownPaths = new Set(files.map((file) => file.path));

  return {
    ...analysis,
    mentionedFiles: analysis.mentionedFiles.filter((path) => knownPaths.has(path)),
    breakingReason: analysis.isBreaking ? analysis.breakingReason : null,
    mismatchReason: analysis.messageMatchesDiff ? null : analysis.mismatchReason,
  };
}
