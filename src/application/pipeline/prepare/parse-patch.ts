export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses the `patch` field GitHub returns for a file: a list of unified-diff hunks
 * without the `diff --git` / `---` / `+++` file headers.
 */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      current = {
        header: raw,
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }

    if (!current) continue;

    const marker = raw[0];
    const content = raw.slice(1);
    if (marker === "+") current.lines.push({ type: "add", content });
    else if (marker === "-") current.lines.push({ type: "del", content });
    else if (marker === " ") current.lines.push({ type: "context", content });
  }

  return hunks;
}
