import { describe, expect, it } from "vitest";
import type { ChangeUnit, FileChange } from "../../../domain/schemas/change-unit.ts";
import { prepareUnit, type PreparedUnit, type PrepareResult } from "./prepare-unit.ts";

function file(path: string, overrides: Partial<FileChange> = {}): FileChange {
  return {
    path,
    previousPath: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-old\n+new",
    ...overrides,
  };
}

function unit(files: FileChange[]): ChangeUnit {
  return {
    kind: "pr",
    ref: "#7",
    url: "https://github.com/acme/app/pull/7",
    title: "Some change",
    body: null,
    author: "dev",
    date: new Date("2026-10-01T00:00:00Z"),
    files,
  };
}

function bigPatch(hunks: number, linesPerHunk: number): string {
  return Array.from({ length: hunks }, (_, h) =>
    [`@@ -${h * 100 + 1},${linesPerHunk} +${h * 100 + 1},${linesPerHunk} @@`, ...Array.from({ length: linesPerHunk }, (_, l) => `+line ${h}-${l} ${"x".repeat(50)}`)].join("\n"),
  ).join("\n");
}

function expectReady(result: PrepareResult): PreparedUnit {
  if (result.status !== "ready") throw new Error(`expected ready, got skipped: ${result.skipped.reason}`);
  return result.prepared;
}

describe("prepareUnit — filtro", () => {
  it("pula a unidade quando só há arquivos de ruído", () => {
    const result = prepareUnit(unit([file("package-lock.json"), file("dist/app.js")]));

    expect(result).toEqual({
      status: "skipped",
      skipped: {
        ref: "#7",
        reason: "No analyzable changes: package-lock.json (lockfile), dist/app.js (build output or vendored code)",
      },
    });
  });

  it("resume a lista de motivos quando há muitos arquivos ignorados", () => {
    const files = ["a", "b", "c", "d", "e"].map((name) => file(`dist/${name}.js`));
    const result = prepareUnit(unit(files));

    expect(result.status === "skipped" && result.skipped.reason).toMatch(/and 2 more$/);
  });

  it("pula a unidade sem arquivos", () => {
    expect(prepareUnit(unit([]))).toMatchObject({ status: "skipped", skipped: { reason: "No file changes" } });
  });

  it("mantém o código, registra o que foi omitido e não marca como truncado", () => {
    const prepared = expectReady(prepareUnit(unit([file("src/app.ts"), file("pnpm-lock.yaml"), file("logo.png", { patch: null })])));

    expect(prepared.files.map((f) => f.path)).toEqual(["src/app.ts"]);
    expect(prepared.omittedFiles).toEqual([
      { path: "pnpm-lock.yaml", reason: "lockfile" },
      { path: "logo.png", reason: "no patch available (binary or too large)" },
    ]);
    expect(prepared.truncated).toBe(false);
  });

  it("mantém arquivos removidos sem o conteúdo e renomeações puras sem patch", () => {
    const prepared = expectReady(
      prepareUnit(
        unit([
          file("src/legacy.ts", { status: "removed", deletions: 500, patch: bigPatch(5, 100) }),
          file("src/new-name.ts", { status: "renamed", previousPath: "src/old-name.ts", patch: null }),
        ]),
      ),
    );

    expect(prepared.files).toEqual([
      expect.objectContaining({ path: "src/legacy.ts", status: "removed", deletions: 500, hunks: [] }),
      expect.objectContaining({ path: "src/new-name.ts", previousPath: "src/old-name.ts", hunks: [] }),
    ]);
  });
});

describe("prepareUnit — orçamento de tokens", () => {
  it("prioriza código-fonte antes de testes e docs", () => {
    const prepared = expectReady(prepareUnit(unit([file("README.md"), file("src/a.test.ts"), file("src/a.ts")])));

    expect(prepared.files.map((f) => f.path)).toEqual(["src/a.ts", "src/a.test.ts", "README.md"]);
  });

  it("corta um arquivo grande em limite de hunk e marca como truncado", () => {
    const prepared = expectReady(prepareUnit(unit([file("src/big.ts", { patch: bigPatch(10, 20) })]), { maxTokens: 1_500 }));
    const [big] = prepared.files;

    expect(big?.hunks.length).toBeGreaterThan(0);
    expect(big?.hunks.length).toBeLessThan(10);
    expect(big?.truncated).toBe(true);
    expect(prepared.truncated).toBe(true);
    expect(prepared.estimatedTokens).toBeLessThanOrEqual(1_500);
  });

  it("omite o que não cabe, mas ainda inclui arquivos menores que vêm depois", () => {
    const prepared = expectReady(
      prepareUnit(
        unit([
          file("src/small-1.ts"),
          file("src/huge.ts", { patch: bigPatch(1, 200) }),
          file("src/small-2.ts"),
        ]),
        { maxTokens: 500 },
      ),
    );

    expect(prepared.files.map((f) => f.path)).toEqual(["src/small-1.ts", "src/small-2.ts"]);
    expect(prepared.omittedFiles).toEqual([{ path: "src/huge.ts", reason: "token budget exceeded" }]);
    expect(prepared.truncated).toBe(true);
  });

  it("pula a unidade quando nenhum arquivo cabe no orçamento", () => {
    const result = prepareUnit(unit([file("src/huge.ts", { patch: bigPatch(1, 200) })]), { maxTokens: 100 });

    expect(result).toMatchObject({ status: "skipped", skipped: { reason: "No file fits the token budget of 100" } });
  });

  it("não inclui o patch bruto no resultado", () => {
    const prepared = expectReady(prepareUnit(unit([file("src/app.ts")])));
    expect(prepared.files[0]).not.toHaveProperty("patch");
  });
});
