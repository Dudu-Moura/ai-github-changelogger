import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LLMOutputError, LLMProviderError } from "../../domain/errors.ts";
import { createAnthropicClient } from "./anthropic-client.ts";
import { ClaudeProvider } from "./claude-provider.ts";

const schema = z.object({ title: z.string(), confidence: z.number().min(0).max(1) });
const VALID = JSON.stringify({ title: "Add login", confidence: 0.9 });
const OUT_OF_BOUNDS = JSON.stringify({ title: "Add login", confidence: 1.5 });

interface FakeReply {
  content?: Array<{ type: "text"; text: string } | { type: "fallback"; from: { model: string }; to: { model: string } }>;
  model?: string;
  stopReason?: string;
  stopDetails?: unknown;
  iterations?: unknown[];
  status?: number;
}

function text(value: string) {
  return { type: "text" as const, text: value };
}

function sse(reply: FakeReply): string {
  const content = reply.content ?? [];
  const events: Array<Record<string, unknown>> = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: reply.model ?? "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    },
  ];

  content.forEach((block, index) => {
    if (block.type === "fallback") {
      events.push({ type: "content_block_start", index, content_block: block });
    } else {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    }
    events.push({ type: "content_block_stop", index });
  });

  events.push({
    type: "message_delta",
    delta: { stop_reason: reply.stopReason ?? "end_turn", stop_sequence: null, stop_details: reply.stopDetails ?? null },
    usage: { output_tokens: 100_000, iterations: reply.iterations ?? null },
  });
  events.push({ type: "message_stop" });

  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function fakeClaude(replies: FakeReply[]) {
  const requests: Array<{ body: Record<string, unknown>; beta: string | null }> = [];

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      beta: new Headers(init?.headers).get("anthropic-beta"),
    });

    const reply = replies[requests.length - 1];
    if (!reply) throw new Error("unexpected request");
    if (reply.status) {
      return Response.json({ type: "error", error: { type: "error", message: "nope" } }, { status: reply.status });
    }
    return new Response(sse(reply), { headers: { "content-type": "text/event-stream" } });
  };

  const client = createAnthropicClient({ apiKey: "test", maxRetries: 0, fetch });
  return { provider: new ClaudeProvider(client, { effort: "low" }), requests };
}

function request(model = "claude-opus-5-5") {
  return { model, system: "You analyze diffs.", prompt: "Analyze this.", schema };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

describe("ClaudeProvider — resposta válida", () => {
  it("devolve os dados validados com modelo, tokens e custo", async () => {
    const { provider } = fakeClaude([{ content: [text(VALID)] }]);

    await expect(provider.generateStructured(request())).resolves.toEqual({
      data: { title: "Add login", confidence: 0.9 },
      model: "claude-opus-5-5",
      usage: { inputTokens: 1_000_000, outputTokens: 100_000, estimatedCostUsd: 6 },
    });
  });

  it("envia system, prompt, effort e o JSON schema", async () => {
    const { provider, requests } = fakeClaude([{ content: [text(VALID)] }]);

    await provider.generateStructured(request());
    const body = requests[0]?.body;

    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      system: "You analyze diffs.",
      messages: [{ role: "user", content: "Analyze this." }],
      stream: true,
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("temperature");
  });

  it("ativa o fallback nos modelos que suportam", async () => {
    const { provider, requests } = fakeClaude([{ content: [text(VALID)] }]);

    await provider.generateStructured(request());

    expect(requests[0]?.body).toMatchObject({ fallbacks: "default" });
    expect(requests[0]?.beta).toContain("server-side-fallback-2026-07-01");
  });

  it("não envia fallback para modelos sem suporte", async () => {
    const { provider, requests } = fakeClaude([{ content: [text(VALID)], model: "claude-haiku-5-5" }]);

    await provider.generateStructured(request("claude-haiku-5-5"));

    expect(requests[0]?.body).not.toHaveProperty("fallbacks");
    expect(requests[0]?.body).not.toHaveProperty("betas");
    expect(requests[0]?.beta ?? "").not.toContain("server-side-fallback");
  });

  it("informa custo nulo para um modelo sem preço conhecido", async () => {
    const { provider } = fakeClaude([{ content: [text(VALID)], model: "claude-future-9" }]);

    const response = await provider.generateStructured(request("claude-future-9"));

    expect(response.usage.estimatedCostUsd).toBeNull();
  });
});

describe("ClaudeProvider — fallback", () => {
  const iterations = [
    { type: "message", input_tokens: 1_000_000, output_tokens: 0, model: "claude-opus-5-5" },
    { type: "fallback_message", input_tokens: 1_000_000, output_tokens: 100_000, model: "claude-opus-4-8" },
  ];
  const switchBlock = {
    type: "fallback" as const,
    from: { model: "claude-opus-5-5" },
    to: { model: "claude-opus-4-8" },
  };

  it("soma cada tentativa no preço do próprio modelo e informa quem respondeu", async () => {
    const { provider } = fakeClaude([{ content: [switchBlock, text(VALID)], iterations }]);

    const response = await provider.generateStructured(request());

    expect(response.model).toBe("claude-opus-4-8");
    expect(response.usage).toEqual({ inputTokens: 2_000_000, outputTokens: 100_000, estimatedCostUsd: 4 + 5 + 2.5 });
  });

  it("junta o texto quando o segundo modelo continua a resposta do primeiro", async () => {
    const { provider } = fakeClaude([
      { content: [text(VALID.slice(0, 10)), switchBlock, text(VALID.slice(10))], iterations },
    ]);

    const response = await provider.generateStructured(request());

    expect(response.data.title).toBe("Add login");
  });
});

describe("ClaudeProvider — saída inutilizável", () => {
  it("tenta de novo quando a saída viola o schema e soma o gasto das duas tentativas", async () => {
    const { provider, requests } = fakeClaude([{ content: [text(OUT_OF_BOUNDS)] }, { content: [text(VALID)] }]);

    const response = await provider.generateStructured(request());

    expect(requests).toHaveLength(2);
    expect(response.usage.inputTokens).toBe(2_000_000);
  });

  it("desiste após a segunda saída inválida, preservando o gasto", async () => {
    const { provider, requests } = fakeClaude([{ content: [text(OUT_OF_BOUNDS)] }, { content: [text("not json")] }]);

    const error = await failure(provider.generateStructured(request()));

    expect(error).toBeInstanceOf(LLMOutputError);
    expect(error).toMatchObject({ failure: "invalid_output", usage: { inputTokens: 2_000_000 } });
    expect((error as Error).message).toContain("not valid JSON");
    expect(requests).toHaveLength(2);
  });

  it("não repete uma recusa e informa a categoria", async () => {
    const { provider, requests } = fakeClaude([
      { stopReason: "refusal", stopDetails: { type: "refusal", category: "cyber", explanation: null } },
    ]);

    const error = await failure(provider.generateStructured(request()));

    expect(error).toMatchObject({ failure: "refusal", usage: { inputTokens: 1_000_000 } });
    expect((error as Error).message).toContain("cyber");
    expect(requests).toHaveLength(1);
  });

  it("não repete uma resposta cortada, mesmo com JSON incompleto", async () => {
    const { provider, requests } = fakeClaude([{ content: [text('{"title": "Add')], stopReason: "max_tokens" }]);

    const error = await failure(provider.generateStructured(request()));

    expect(error).toMatchObject({ failure: "truncated", usage: { outputTokens: 100_000 } });
    expect(requests).toHaveLength(1);
  });
});

describe("ClaudeProvider — erros da API", () => {
  it.each([
    [401, "ANTHROPIC_API_KEY"],
    [403, "ANTHROPIC_API_KEY"],
    [404, "MAP_MODEL"],
    [400, "rejected the request"],
    [402, "billing"],
  ])("HTTP %i interrompe a execução", async (status, message) => {
    const { provider } = fakeClaude([{ status }]);

    const error = await failure(provider.generateStructured(request()));

    expect(error).toBeInstanceOf(LLMProviderError);
    expect(error).toMatchObject({ fatal: true });
    expect((error as Error).message).toContain(message);
  });

  it.each([429, 500, 529])("HTTP %i afeta só a requisição atual", async (status) => {
    const { provider } = fakeClaude([{ status }]);

    const error = await failure(provider.generateStructured(request()));

    expect(error).toBeInstanceOf(LLMProviderError);
    expect(error).toMatchObject({ fatal: false });
  });
});
