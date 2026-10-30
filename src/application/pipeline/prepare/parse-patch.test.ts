import { describe, expect, it } from "vitest";
import { parsePatch } from "./parse-patch.ts";

describe("parsePatch", () => {
  it("separa hunks e classifica cada linha", () => {
    const patch = [
      "@@ -1,3 +1,4 @@ export function login() {",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
      "@@ -20,2 +21,2 @@",
      "-return a;",
      "+return a + b;",
    ].join("\n");

    const hunks = parsePatch(patch);

    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toEqual({
      header: "@@ -1,3 +1,4 @@ export function login() {",
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      lines: [
        { type: "context", content: "const a = 1;" },
        { type: "del", content: "const b = 2;" },
        { type: "add", content: "const b = 3;" },
        { type: "add", content: "const c = 4;" },
      ],
    });
    expect(hunks[1]).toMatchObject({ oldStart: 20, newStart: 21, lines: [{ type: "del" }, { type: "add" }] });
  });

  it("assume 1 linha quando o header omite a contagem", () => {
    const [hunk] = parsePatch("@@ -5 +5 @@\n-a\n+b");
    expect(hunk).toMatchObject({ oldStart: 5, oldLines: 1, newStart: 5, newLines: 1 });
  });

  it("ignora o marcador de 'sem quebra de linha no final'", () => {
    const [hunk] = parsePatch("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b");
    expect(hunk?.lines).toEqual([
      { type: "del", content: "a" },
      { type: "add", content: "b" },
    ]);
  });

  it("preserva linhas de contexto vazias", () => {
    const [hunk] = parsePatch("@@ -1,3 +1,3 @@\n a\n \n-b\n+c");
    expect(hunk?.lines[1]).toEqual({ type: "context", content: "" });
  });

  it("retorna lista vazia para patch vazio ou sem hunks", () => {
    expect(parsePatch("")).toEqual([]);
    expect(parsePatch("Binary files differ")).toEqual([]);
  });
});
