import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { LLMOutputError, LLMProviderError } from "../../domain/errors.ts";
import type {
  LLMProvider,
  StructuredRequest,
  StructuredResponse,
  TokenUsage,
} from "../../domain/ports/llm-provider.ts";
import { addUsage, ZERO_USAGE } from "../../domain/rules/usage.ts";
import { estimateCostUsd } from "./anthropic-pricing.ts";

const MAX_OUTPUT_TOKENS = 64_000;
const MAX_ATTEMPTS = 2;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MODELS_WITH_FALLBACK = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export type ClaudeEffort = "low" | "medium" | "high";

export interface ClaudeProviderOptions {
  effort: ClaudeEffort;
}

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";

  #client: Anthropic;
  #effort: ClaudeEffort;

  constructor(client: Anthropic, { effort }: ClaudeProviderOptions) {
    this.#client = client;
    this.#effort = effort;
  }

  /**
   * Retries only invalid output: the API enforces the schema's shape, but not
   * bounds such as `max(1)`, so a new sample can fix it. A refusal or a cut-off
   * answer would just happen again, so those fail right away.
   */
  async generateStructured<S extends z.ZodType>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResponse<z.output<S>>> {
    let usage = ZERO_USAGE;
    let lastIssue = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const message = await this.#send(request);
      usage = addUsage(usage, readUsage(message, request.model));
      assertComplete(message, usage);

      const output = parseOutput(message, request.schema);
      if (output.success) {
        return { data: output.data, model: message.model, usage };
      }
      lastIssue = output.issue;
    }

    throw new LLMOutputError(
      `Model output did not match the schema after ${MAX_ATTEMPTS} attempts: ${lastIssue}`,
      "invalid_output",
      usage,
    );
  }

  /**
   * Streams because a long answer could outlast a plain HTTP request. Only the
   * JSON schema is sent, not the SDK's parser: it would throw on a truncated
   * answer before stop_reason and usage could be read.
   */
  async #send<S extends z.ZodType>({ model, system, prompt, schema }: StructuredRequest<S>): Promise<BetaMessage> {
    const { schema: jsonSchema } = betaZodOutputFormat(schema);

    try {
      return await this.#client.beta.messages
        .stream({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          messages: [{ role: "user", content: prompt }],
          output_config: { effort: this.#effort, format: { type: "json_schema", schema: jsonSchema } },
          ...(MODELS_WITH_FALLBACK.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        })
        .finalMessage();
    } catch (error) {
      throw toDomainError(error, model);
    }
  }
}

function assertComplete(message: BetaMessage, usage: TokenUsage): void {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "unspecified";
    throw new LLMOutputError(`Model refused the request (category: ${category})`, "refusal", usage);
  }

  if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
    throw new LLMOutputError(`Model output was cut off (${message.stop_reason})`, "truncated", usage);
  }
}

/**
 * Joins every text block: after a fallback in the middle of an answer, the
 * second model continues the text the first one started.
 */
function parseOutput<S extends z.ZodType>(
  message: BetaMessage,
  schema: S,
): { success: true; data: z.output<S> } | { success: false; issue: string } {
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { success: false, issue: "response is not valid JSON" };
  }

  const result = schema.safeParse(json);
  if (result.success) return { success: true, data: result.data };

  return { success: false, issue: result.error.issues.map((issue) => issue.message).join("; ") };
}

/**
 * Prices each attempt at its own model. After a fallback, `usage.iterations` is
 * the full record: the top-level numbers only cover the attempt that answered.
 */
function readUsage(message: BetaMessage, requestedModel: string): TokenUsage {
  const attempts = (message.usage.iterations ?? []).filter(
    (entry) => entry.type === "message" || entry.type === "fallback_message",
  );

  if (attempts.length === 0) {
    return toUsage(message.model, message.usage.input_tokens, message.usage.output_tokens);
  }

  return attempts
    .map((entry) => toUsage(("model" in entry && entry.model) || requestedModel, entry.input_tokens, entry.output_tokens))
    .reduce(addUsage, ZERO_USAGE);
}

function toUsage(model: string, inputTokens: number, outputTokens: number): TokenUsage {
  return { inputTokens, outputTokens, estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens) };
}

function toDomainError(error: unknown, model: string): LLMProviderError {
  const reason = error instanceof Error ? error.message : String(error);
  const options = { cause: error };

  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new LLMProviderError("Claude rejected the credentials. Check ANTHROPIC_API_KEY.", true, options);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new LLMProviderError(`Claude model ${model} not found. Check MAP_MODEL and REDUCE_MODEL.`, true, options);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new LLMProviderError(`Claude rejected the request: ${reason}`, true, options);
  }
  if (error instanceof Anthropic.APIError && error.status === 402) {
    return new LLMProviderError("Claude rejected the request: check your account billing.", true, options);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LLMProviderError("Claude rate limit reached. Lower MAX_CONCURRENCY.", false, options);
  }

  return new LLMProviderError(`Failed to call Claude: ${reason}`, false, options);
}
