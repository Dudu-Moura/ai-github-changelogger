import { describe, expect, it } from "vitest";
import type { PreparedFile, PreparedUnit } from "../prepare/prepare-unit.ts";
import { buildAnalyzePrompt } from "./prompt.ts";

function file(overrides: Partial<PreparedFile> = {}): PreparedFile {
  return {
    path: "src/auth.ts",
    previousPath: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    truncated: false,
    hunks: [
      {
        header: "@@ -1,2 +1,2 @@ login()",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { type: "context", content: "const a = 1;" },
          { type: "del", content: "const b = 2;" },
          { type: "add", content: "const b = 3;" },
        ],
      },
    ],
    ...overrides,
  };
}

function prepared(overrides: Partial<PreparedUnit> = {}, body: string | null = "Fixes login"): PreparedUnit {
  return {
    unit: {
      kind: "pr",
      ref: "#42",
      url: "https://github.com/acme/app/pull/42",
      title: "Fix login",
      body,
      author: "dev",
      date: new Date("2026-10-01T00:00:00Z"),
      files: [],
    },
    files: [file()],
    omittedFiles: [],
    truncated: false,
    estimatedTokens: 100,
    ...overrides,
  };
}

describe("buildAnalyzePrompt", () => {
  it("monta título, descrição e diff com os prefixos de cada linha", () => {
    const prompt = buildAnalyzePrompt(prepared(), "en");

    expect(prompt).toContain('<change type="pr" ref="#42">');
    expect(prompt).toContain("<title>Fix login</title>");
    expect(prompt).toContain("<description>Fixes login</description>");
    expect(prompt).toContain(
      ["=== src/auth.ts (modified, +1 -1)", "@@ -1,2 +1,2 @@ login()", " const a = 1;", "-const b = 2;", "+const b = 3;"].join("\n"),
    );
  });

  it("pede a resposta no idioma solicitado", () => {
    expect(buildAnalyzePrompt(prepared(), "pt-BR")).toContain("in pt-BR");
  });

  it("marca a ausência de descrição", () => {
    expect(buildAnalyzePrompt(prepared({}, null), "en")).toContain("<description>(none)</description>");
  });

  it("corta descrições muito longas", () => {
    const prompt = buildAnalyzePrompt(prepared({}, "x".repeat(10_000)), "en");

    expect(prompt).toContain("[description cut for length]");
    expect(prompt.length).toBeLessThan(6_000);
  });

  it("descreve arquivos renomeados e removidos, que não têm hunks", () => {
    const prompt = buildAnalyzePrompt(
      prepared({
        files: [
          file({ path: "src/new.ts", previousPath: "src/old.ts", status: "renamed", additions: 0, deletions: 0, hunks: [] }),
          file({ path: "src/legacy.ts", status: "removed", additions: 0, deletions: 500, hunks: [] }),
        ],
      }),
      "en",
    );

    expect(prompt).toContain("=== src/new.ts (renamed from src/old.ts, +0 -0)");
    expect(prompt).toContain("=== src/legacy.ts (removed, +0 -500, content not shown)");
  });

  it("avisa quando o diff está incompleto", () => {
    const prompt = buildAnalyzePrompt(prepared({ files: [file({ truncated: true })], truncated: true }), "en");

    expect(prompt).toContain("[remaining hunks of this file are not shown]");
    expect(prompt).toContain("The diff is incomplete");
  });

  it("não fala em diff incompleto quando nada foi cortado", () => {
    expect(buildAnalyzePrompt(prepared(), "en")).not.toContain("incomplete");
  });

  it("lista os arquivos omitidos com limite", () => {
    const omittedFiles = Array.from({ length: 25 }, (_, i) => ({ path: `dist/${i}.js`, reason: "build output or vendored code" }));

    const prompt = buildAnalyzePrompt(prepared({ omittedFiles }), "en");

    expect(prompt).toContain("dist/19.js (build output or vendored code)");
    expect(prompt).not.toContain("dist/20.js");
    expect(prompt).toContain("and 5 more");
  });

  it("não inclui a seção de omitidos quando não há nenhum", () => {
    expect(buildAnalyzePrompt(prepared(), "en")).not.toContain("<omitted_files>");
  });
});
