import { z } from "zod";
import { changeKindSchema } from "./common.ts";

export const MAX_UNITS_PER_RUN = 100;

export const repoRefSchema = z
  .string()
  .trim()
  .regex(/^([\w.-]+)\/([\w.-]+)$/, "repo deve estar no formato owner/name")
  .transform((value) => {
    const [owner, name] = value.split("/") as [string, string];
    return { owner, name };
  });
export type RepoRef = z.output<typeof repoRefSchema>;

const lastRangeSchema = z.strictObject({
  type: z.literal("last"),
  count: z.coerce.number().int().min(1).max(MAX_UNITS_PER_RUN),
});

const dateRangeSchema = z
  .strictObject({
    type: z.literal("date"),
    since: z.coerce.date(),
    until: z.coerce.date().optional(),
  })
  .refine((range) => !range.until || range.since <= range.until, {
    message: "since deve ser anterior ou igual a until",
    path: ["until"],
  });

export const changeRangeSchema = z.discriminatedUnion("type", [lastRangeSchema, dateRangeSchema]);
export type ChangeRange = z.output<typeof changeRangeSchema>;

export const languageSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "idioma deve ser um código como en, pt-BR ou es");

export const changelogRequestSchema = z.object({
  repo: repoRefSchema,
  range: changeRangeSchema,
  source: changeKindSchema.default("pr"),
  language: languageSchema.default("en"),
});

export type ChangelogRequestInput = z.input<typeof changelogRequestSchema>;
export type ChangelogRequest = z.output<typeof changelogRequestSchema>;
