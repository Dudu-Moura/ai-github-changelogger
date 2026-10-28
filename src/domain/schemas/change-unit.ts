import { z } from "zod";
import { changeKindSchema } from "./common.ts";

export const fileStatusSchema = z.enum(["added", "modified", "removed", "renamed"]);
export type FileStatus = z.infer<typeof fileStatusSchema>;

export const fileChangeSchema = z.object({
  path: z.string().min(1),
  previousPath: z.string().nullable(),
  status: fileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().nullable(),
});
export type FileChange = z.infer<typeof fileChangeSchema>;

export const changeUnitSchema = z.object({
  kind: changeKindSchema,
  ref: z.string().min(1),
  url: z.url(),
  title: z.string(),
  body: z.string().nullable(),
  author: z.string().nullable(),
  date: z.date(),
  files: z.array(fileChangeSchema),
});
export type ChangeUnit = z.infer<typeof changeUnitSchema>;
