import { z } from "zod";

const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

const optionalSecret = z.preprocess(emptyAsUndefined, z.string().trim().min(1).optional());

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.preprocess(
    emptyAsUndefined,
    z.string({ error: "ANTHROPIC_API_KEY é obrigatória" }).trim().min(1),
  ),
  GITHUB_TOKEN: optionalSecret,
  HF_TOKEN: optionalSecret,

  MAP_MODEL: z.preprocess(emptyAsUndefined, z.string().min(1).default("claude-opus-5-5")),
  REDUCE_MODEL: z.preprocess(emptyAsUndefined, z.string().min(1).default("claude-opus-5-5")),
  LLM_EFFORT: z.preprocess(emptyAsUndefined, z.enum(["low", "medium", "high"]).default("medium")),

  MAX_CONCURRENCY: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(16).default(4),
  ),
  LOG_LEVEL: z.preprocess(
    emptyAsUndefined,
    z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ),
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  override name = "InvalidEnvError";
}

/**
 * Validates environment variables and returns a typed config object.
 * Takes `source` as a parameter (instead of reading process.env directly)
 * so tests can pass any scenario without touching global state.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new InvalidEnvError(
      `Configuração inválida:\n${z.prettifyError(result.error)}\n\nVeja o .env.example.`,
    );
  }

  return result.data;
}
