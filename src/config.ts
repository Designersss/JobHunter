import "dotenv/config";

export interface Config {
  databaseUrl: string;
  telegramToken: string;
  telegramOwnerId: string;
  telegramChannelId: string;
  pollIntervalMinutes: number;
  maxPostsPerCycle: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error("Missing required environment variable: " + key);
  return value;
}

function intOption(value: string | undefined, fallback: number, min: number, max: number): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error("Invalid numeric configuration: " + value);
  }
  return number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    telegramToken: required(env, "TELEGRAM_BOT_TOKEN"),
    telegramOwnerId: required(env, "TELEGRAM_OWNER_ID"),
    telegramChannelId: required(env, "TELEGRAM_CHANNEL_ID"),
    pollIntervalMinutes: intOption(env.POLL_INTERVAL_MINUTES, 15, 5, 1440),
    maxPostsPerCycle: intOption(env.MAX_TELEGRAM_POSTS_PER_CYCLE, 25, 1, 100)
  };
}
