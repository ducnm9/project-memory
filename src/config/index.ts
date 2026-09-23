import { z } from "zod";

function defaultModel(provider: string): string {
  if (provider === "anthropic") return "claude-3-5-haiku-20241022";
  if (provider === "google") return "gemini-2.0-flash";
  return "gpt-4o-mini";
}

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
  logLevel: string;
  mongodbUri: string;
  mongodbDbName: string;
  authAdminKey: string;
  authTokenPepper: string;
  credentialEncryptionKey: string;
  llm: {
    provider: "openai" | "anthropic" | "google";
    model: string;
    apiKey: string;
  } | null;
}

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1),
  AUTH_ADMIN_KEY: z.string().default(""),
  AUTH_TOKEN_PEPPER: z.string().default(""),
  CREDENTIAL_ENCRYPTION_KEY: z.string().default("0".repeat(64)),
  LLM_PROVIDER: z.enum(["openai", "anthropic", "google"]).optional(),
  LLM_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Readonly<AppConfig> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${detail}`);
  }
  const data = parsed.data;
  if (data.NODE_ENV === "production") {
    const missing: string[] = [];
    if (data.AUTH_ADMIN_KEY.length === 0) missing.push("AUTH_ADMIN_KEY");
    if (data.AUTH_TOKEN_PEPPER.length === 0) missing.push("AUTH_TOKEN_PEPPER");
    if (data.CREDENTIAL_ENCRYPTION_KEY.length < 64) missing.push("CREDENTIAL_ENCRYPTION_KEY");
    if (missing.length > 0) {
      throw new Error(`Invalid configuration: ${missing.join(", ")} required in production`);
    }
  }
  return Object.freeze({
    port: data.PORT,
    host: data.HOST,
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    mongodbUri: data.MONGODB_URI,
    mongodbDbName: data.MONGODB_DB_NAME,
    authAdminKey: data.AUTH_ADMIN_KEY,
    authTokenPepper: data.AUTH_TOKEN_PEPPER,
    credentialEncryptionKey: data.CREDENTIAL_ENCRYPTION_KEY,
    llm: (() => {
      const provider = data.LLM_PROVIDER;
      const apiKey = provider === "openai" ? data.OPENAI_API_KEY
        : provider === "anthropic" ? data.ANTHROPIC_API_KEY
        : provider === "google" ? data.GOOGLE_GENERATIVE_AI_API_KEY
        : undefined;
      if (!provider || !apiKey) return null;
      return { provider, model: data.LLM_MODEL ?? defaultModel(provider), apiKey };
    })(),
  });
}
