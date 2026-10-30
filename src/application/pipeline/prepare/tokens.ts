import type { FileChange } from "../../../domain/schemas/change-unit.ts";
import type { Hunk } from "./parse-patch.ts";

const CHARS_PER_TOKEN = 3;

/**
 * Cheap, deliberately pessimistic token estimate. Code tokenizes denser than prose,
 * so 3 chars/token overestimates slightly, which keeps us under budget.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateHunkTokens(hunk: Hunk): number {
  const chars = hunk.lines.reduce((sum, line) => sum + line.content.length + 2, hunk.header.length + 1);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function estimateFileHeaderTokens(file: Pick<FileChange, "path" | "previousPath" | "status">): number {
  return estimateTokens(`${file.status} ${file.previousPath ?? ""} ${file.path}`) + 10;
}
