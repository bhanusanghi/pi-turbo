import { AppError } from "./contracts.js";

export type Config = {
  databaseUrl: string; redisUrl: string; apiToken: string; host: string; port: number;
  queuePrefix: string; refreshIntervalMs: number; dispatchIntervalMs: number;
  sourceDataDir?: string;
};
export function connectionUrl(value: string, name: string, protocols: string[]): string {
  try {
    if (!protocols.includes(new URL(value).protocol)) throw new Error("protocol");
    return value;
  } catch { throw new AppError("configuration", `${name} must be a valid ${protocols.join(" or ")} URL`); }
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new AppError("configuration", `${name} is required`);
    return value;
  };
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new AppError("configuration", `${name} must be between ${min} and ${max}`);
    return value;
  };
  const databaseUrl = connectionUrl(required("DATABASE_URL"), "DATABASE_URL", ["postgres:", "postgresql:"]);
  const redisUrl = connectionUrl(required("REDIS_URL"), "REDIS_URL", ["redis:", "rediss:"]);
  const apiToken = required("API_TOKEN");
  if (apiToken.length < 24) throw new AppError("configuration", "API_TOKEN must be at least 24 characters");
  const queuePrefix = env.QUEUE_PREFIX ?? "portfolio-monitor";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(queuePrefix)) throw new AppError("configuration", "QUEUE_PREFIX must contain letters, numbers, underscores or hyphens");
  return { databaseUrl, redisUrl, apiToken, queuePrefix, sourceDataDir: env.SOURCE_DATA_DIR ?? ".source-data", host: env.HOST ?? "127.0.0.1",
    port: integer("PORT", 8787, 1, 65535), refreshIntervalMs: integer("REFRESH_INTERVAL_MS", 60_000, 1_000, 86_400_000),
    dispatchIntervalMs: integer("DISPATCH_INTERVAL_MS", 500, 50, 60_000) };
}
