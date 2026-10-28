import type { z } from "zod";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
   * Implementations must throw when the model output does not match the schema.
   */
  generateStructured<S extends z.ZodType>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResponse<z.output<S>>>;
}
