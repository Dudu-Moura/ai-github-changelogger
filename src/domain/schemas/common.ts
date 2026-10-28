import { z } from "zod";

export const categorySchema = z.enum([
  "feature",
  "fix",
  "refactor",
  "perf",
  "security",
  "docs",
  "test",
  "chore",
]);
export type Category = z.infer<typeof categorySchema>;

export const impactSchema = z.enum(["low", "medium", "high"]);
export type Impact = z.infer<typeof impactSchema>;

export const changeKindSchema = z.enum(["pr", "commit"]);
export type ChangeKind = z.infer<typeof changeKindSchema>;
