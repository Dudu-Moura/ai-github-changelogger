import { describe, expect, it } from "vitest";
import { changelogRequestSchema } from "./changelog-request.ts";

const parse = (input: unknown) => changelogRequestSchema.safeParse(input);

describe("changelogRequestSchema", () => {
  it("converte 'owner/name' em objeto e aplica defaults", () => {
    const result = parse({ repo: "facebook/react", range: { type: "last", count: 10 } });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      repo: { owner: "facebook", name: "react" },
      range: { type: "last", count: 10 },
      source: "pr",
      language: "en",
    });
  });

  it.each(["react", "facebook/react/extra", "facebook/", "/react", "face book/react"])(
    "rejeita repo malformado: %s",
    (repo) => {
      expect(parse({ repo, range: { type: "last", count: 1 } }).success).toBe(false);
    },
  );

  it("converte count vindo da CLI como string e respeita o limite", () => {
    expect(parse({ repo: "a/b", range: { type: "last", count: "20" } }).data?.range).toEqual({
      type: "last",
      count: 20,
    });
    expect(parse({ repo: "a/b", range: { type: "last", count: 0 } }).success).toBe(false);
    expect(parse({ repo: "a/b", range: { type: "last", count: 101 } }).success).toBe(false);
  });

  it("aceita intervalo por data com until opcional", () => {
    const result = parse({ repo: "a/b", range: { type: "date", since: "2026-10-01" } });

    expect(result.success).toBe(true);
    expect(result.data?.range).toEqual({ type: "date", since: new Date("2026-10-01") });
  });

  it("rejeita since posterior a until, apontando o campo until", () => {
    const result = parse({
      repo: "a/b",
      range: { type: "date", since: "2026-10-10", until: "2026-10-01" },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["range", "until"]);
  });

  it("rejeita datas inválidas", () => {
    expect(parse({ repo: "a/b", range: { type: "date", since: "ontem" } }).success).toBe(false);
  });

  it("não permite misturar count e since: cada tipo só aceita seus campos", () => {
    const dateWithCount = { type: "date", since: "2026-10-01", count: 10 };
    const lastWithSince = { type: "last", count: 10, since: "2026-10-01" };

    expect(parse({ repo: "a/b", range: dateWithCount }).success).toBe(false);
    expect(parse({ repo: "a/b", range: lastWithSince }).success).toBe(false);
  });

  it.each(["pt-BR", "en", "es"])("aceita idioma %s", (language) => {
    expect(parse({ repo: "a/b", range: { type: "last", count: 1 }, language }).success).toBe(true);
  });

  it.each(["portugues", "pt_BR", "PT"])("rejeita idioma %s", (language) => {
    expect(parse({ repo: "a/b", range: { type: "last", count: 1 }, language }).success).toBe(false);
  });
});
