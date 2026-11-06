import { z } from "zod";
import { categorySchema, impactSchema } from "./common.ts";

export const unitAnalysisSchema = z.object({
  category: categorySchema,
  impact: impactSchema,
  title: z.string().min(1).describe("One-line summary of the change, in the requested language"),
  description: z
    .string()
    .min(1)
    .describe("What changed and why it matters, based on the diff, in the requested language"),
  isBreaking: z.boolean(),
  breakingReason: z
    .string()
    .nullable()
    .describe("Why it breaks existing usage; null when isBreaking is false"),
  mentionedFiles: z
    .array(z.string())
    .describe("Paths of the files that support this analysis, copied exactly from the diff"),
  messageMatchesDiff: z
    .boolean()
    .describe("False when the commit/PR message does not describe what the diff actually does"),
  mismatchReason: z
    .string()
    .nullable()
    .describe("What the message gets wrong; null when messageMatchesDiff is true"),
  confidence: z.number().min(0).max(1).describe("From 0 to 1, how well the diff supports this analysis"),
});
export type UnitAnalysis = z.infer<typeof unitAnalysisSchema>;
