import { describe, expect, it } from "vitest";
import { unitAnalysisSchema, type UnitAnalysis } from "./unit-analysis.ts";

const valid: UnitAnalysis = {
  category: "fix",
  impact: "medium",
  title: "Corrige expiração do token",
  description: "O refresh token agora respeita o TTL configurado.",
  isBreaking: false,
  breakingReason: null,
  mentionedFiles: ["src/auth/token.ts"],
  messageMatchesDiff: true,
  mismatchReason: null,
  confidence: 0.9,
};

describe("unitAnalysisSchema", () => {
  it("aceita uma análise válida", () => {
    expect(unitAnalysisSchema.safeParse(valid).success).toBe(true);
  });

  it("rejeita categoria desconhecida", () => {
    expect(unitAnalysisSchema.safeParse({ ...valid, category: "bugfix" }).success).toBe(false);
  });

  it("rejeita confidence fora de 0..1", () => {
    expect(unitAnalysisSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
  });

  it("exige campos anuláveis explícitos: ausente é diferente de null", () => {
    const { breakingReason: _, ...withoutReason } = valid;
    expect(unitAnalysisSchema.safeParse(withoutReason).success).toBe(false);
  });
});
