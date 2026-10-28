import { describe, expect, it } from "vitest";
import { InvalidEnvError, loadEnv } from "./env.ts";

describe("loadEnv", () => {
  it("aplica os defaults quando só a chave obrigatória é informada", () => {
    const env = loadEnv({ ANTHROPIC_API_KEY: "sk-test" });

    expect(env).toEqual({
      ANTHROPIC_API_KEY: "sk-test",
      MAP_MODEL: "claude-opus-5-5",
      REDUCE_MODEL: "claude-opus-5-5",
      LLM_EFFORT: "medium",
      MAX_CONCURRENCY: 4,
      LOG_LEVEL: "info",
    });
  });

  it("falha com mensagem legível quando a ANTHROPIC_API_KEY está ausente", () => {
    expect(() => loadEnv({})).toThrow(InvalidEnvError);
    expect(() => loadEnv({})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("trata valores vazios do .env como ausentes", () => {
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "" })).toThrow(InvalidEnvError);

    const env = loadEnv({ ANTHROPIC_API_KEY: "sk-test", GITHUB_TOKEN: "", MAX_CONCURRENCY: "" });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.MAX_CONCURRENCY).toBe(4);
  });

  it("converte MAX_CONCURRENCY de string para número e respeita os limites", () => {
    expect(loadEnv({ ANTHROPIC_API_KEY: "sk-test", MAX_CONCURRENCY: "8" }).MAX_CONCURRENCY).toBe(8);
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "sk-test", MAX_CONCURRENCY: "0" })).toThrow();
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "sk-test", MAX_CONCURRENCY: "abc" })).toThrow();
  });

  it("rejeita valores fora dos enums", () => {
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "sk-test", LLM_EFFORT: "turbo" })).toThrow(/LLM_EFFORT/);
  });
});
