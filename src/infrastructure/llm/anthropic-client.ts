import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicClientOptions {
  apiKey: string;
  maxRetries?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * Creates the SDK client. It already retries 429, 5xx and connection errors,
 * honoring the retry-after header. `fetch` exists so tests can fake the network.
 */
export function createAnthropicClient({ apiKey, maxRetries, fetch }: AnthropicClientOptions): Anthropic {
  return new Anthropic({ apiKey, maxRetries, fetch });
}
