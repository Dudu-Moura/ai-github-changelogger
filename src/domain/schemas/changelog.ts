import { z } from "zod";
import { changeUnitSchema, fileChangeSchema } from "./change-unit.ts";
import { languageSchema } from "./changelog-request.ts";
import { categorySchema, changeKindSchema, impactSchema } from "./common.ts";

export const sourceRefSchema = changeUnitSchema.pick({ kind: true, ref: true, url: true });
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const fileStatSchema = fileChangeSchema.pick({
  path: true,
  status: true,
  additions: true,
  deletions: true,
});
export type FileStat = z.infer<typeof fileStatSchema>;

export const changelogEntrySchema = z.object({
  title: z.string(),
  description: z.string(),
  impact: impactSchema,
  confidence: z.number().min(0).max(1),
  messageMatchesDiff: z.boolean(),
  truncated: z.boolean(),
  sources: z.array(sourceRefSchema).min(1),
  files: z.array(fileStatSchema),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

const serializedRangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("last"), count: z.number().int() }),
  z.object({ type: z.literal("date"), since: z.iso.datetime(), until: z.iso.datetime().nullable() }),
]);

export const changelogSchema = z.object({
  meta: z.object({
    repo: z.string(),
    source: changeKindSchema,
    range: serializedRangeSchema,
    language: languageSchema,
    generatedAt: z.iso.datetime(),
    models: z.object({ map: z.string(), reduce: z.string() }),
    usage: z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      estimatedCostUsd: z.number().nonnegative(),
    }),
  }),
  summary: z.string(),
  breakingChanges: z.array(
    z.object({
      description: z.string(),
      sources: z.array(sourceRefSchema).min(1),
    }),
  ),
  groups: z.array(
    z.object({
      category: categorySchema,
      entries: z.array(changelogEntrySchema).min(1),
    }),
  ),
  skipped: z.array(
    z.object({
      ref: z.string(),
      reason: z.string(),
    }),
  ),
});
export type Changelog = z.infer<typeof changelogSchema>;
