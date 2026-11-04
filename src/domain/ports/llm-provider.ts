import type { z } from "zod";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Null when the provider cannot price the model that ran. */
  estimatedCostUsd: number | null;
}

export interface StructuredRequest<S extends z.ZodType> {
  model: string;
  system: string;
  prompt: string;
  schema: S;
}

export interface StructuredResponse<T> {
  data: T;
  model: string;
  usage: TokenUsage;
}

export interface LLMProvider {
  readonly name: string;

  /**
   * Sends a prompt and returns a response already validated against `schema`.
   * Throws LLMOutputError when this request produced no usable output, and
   * LLMProviderError when the provider could not serve it.
   */
  generateStructured<S extends z.ZodType>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResponse<z.output<S>>>;
}
