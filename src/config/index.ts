import { z } from "zod";

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
  logLevel: string;
  mongodbUri: string;
  mongodbDbName: string;
  authAdminKey: string;
  authTokenPepper: string;
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
  });
}
