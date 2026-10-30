import { filePriority, noiseReason } from "../../../domain/rules/file-rules.ts";
import type { ChangeUnit, FileChange } from "../../../domain/schemas/change-unit.ts";
import { parsePatch, type Hunk } from "./parse-patch.ts";
import { estimateFileHeaderTokens, estimateHunkTokens } from "./tokens.ts";

export const DEFAULT_MAX_UNIT_TOKENS = 24_000;

export interface PreparedFile extends Omit<FileChange, "patch"> {
  hunks: Hunk[];
  truncated: boolean;
}

export interface OmittedFile {
  path: string;
  reason: string;
}

export interface PreparedUnit {
  unit: ChangeUnit;
  files: PreparedFile[];
  omittedFiles: OmittedFile[];
  truncated: boolean;
  estimatedTokens: number;
}

export interface SkippedUnit {
  ref: string;
  reason: string;
}

export type PrepareResult =
  | { status: "ready"; prepared: PreparedUnit }
  | { status: "skipped"; skipped: SkippedUnit };

export interface PrepareOptions {
  maxTokens?: number;
}

interface Candidate {
  file: FileChange;
  hunks: Hunk[];
}

/**
 * Turns a raw change unit into what the analyzer will see: noise removed,
 * patches parsed, files ordered by relevance and cut to fit the token budget.
 * Units with nothing left to analyze are skipped with a reason.
 */
export function prepareUnit(unit: ChangeUnit, { maxTokens = DEFAULT_MAX_UNIT_TOKENS }: PrepareOptions = {}): PrepareResult {
  const omittedFiles: OmittedFile[] = [];
  const candidates: Candidate[] = [];

  for (const file of unit.files) {
    const noise = noiseReason(file.path);
    if (noise) {
      omittedFiles.push({ path: file.path, reason: noise });
      continue;
    }

    if (file.status === "removed") {
      candidates.push({ file, hunks: [] });
      continue;
    }

    const hunks = file.patch ? parsePatch(file.patch) : [];
    if (hunks.length === 0 && file.status !== "renamed") {
      omittedFiles.push({ path: file.path, reason: "no patch available (binary or too large)" });
      continue;
    }

    candidates.push({ file, hunks });
  }

  if (candidates.length === 0) {
    return { status: "skipped", skipped: { ref: unit.ref, reason: describeSkip(unit, omittedFiles) } };
  }

  const ordered = candidates.toSorted((a, b) => filePriority(a.file.path) - filePriority(b.file.path));
  const { files, overflow, usedTokens } = fitToBudget(ordered, maxTokens);

  if (files.length === 0) {
    return {
      status: "skipped",
      skipped: { ref: unit.ref, reason: `No file fits the token budget of ${maxTokens}` },
    };
  }

  return {
    status: "ready",
    prepared: {
      unit,
      files,
      omittedFiles: [...omittedFiles, ...overflow],
      truncated: overflow.length > 0 || files.some((file) => file.truncated),
      estimatedTokens: usedTokens,
    },
  };
}

/**
 * Greedily adds files in priority order. A file that does not fit whole keeps
 * as many complete hunks as possible; a file with no room at all is omitted,
 * but later (smaller) files still get a chance.
 */
function fitToBudget(candidates: Candidate[], maxTokens: number) {
  const files: PreparedFile[] = [];
  const overflow: OmittedFile[] = [];
  let usedTokens = 0;

  for (const { file, hunks } of candidates) {
    let fileTokens = estimateFileHeaderTokens(file);
    const keptHunks: Hunk[] = [];

    for (const hunk of hunks) {
      const hunkTokens = estimateHunkTokens(hunk);
      if (usedTokens + fileTokens + hunkTokens > maxTokens) break;
      keptHunks.push(hunk);
      fileTokens += hunkTokens;
    }

    const fitsHeader = usedTokens + fileTokens <= maxTokens;
    const lostAllContent = hunks.length > 0 && keptHunks.length === 0;
    if (!fitsHeader || lostAllContent) {
      overflow.push({ path: file.path, reason: "token budget exceeded" });
      continue;
    }

    const { patch: _patch, ...stats } = file;
    files.push({ ...stats, hunks: keptHunks, truncated: keptHunks.length < hunks.length });
    usedTokens += fileTokens;
  }

  return { files, overflow, usedTokens };
}

function describeSkip(unit: ChangeUnit, omittedFiles: OmittedFile[]): string {
  if (unit.files.length === 0) return "No file changes";

  const MAX_LISTED = 3;
  const listed = omittedFiles
    .slice(0, MAX_LISTED)
    .map((file) => `${file.path} (${file.reason})`)
    .join(", ");
  const remaining = omittedFiles.length - MAX_LISTED;

  return `No analyzable changes: ${listed}${remaining > 0 ? ` and ${remaining} more` : ""}`;
}
