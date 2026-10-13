import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { SOURCES } from "./sources.js";
import { Telegram } from "./telegram.js";
import { Runner } from "./runner.js";
import { runBot } from "./bot.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Database(config.databaseUrl);
  await db.init();
  await db.recoverInterruptedSends();
  const tg = new Telegram(config);
  const runner = new Runner(db, tg, SOURCES, config.maxPostsPerCycle);
  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());
  process.once("SIGTERM", () => abort.abort());

  const interval = setInterval(() => {
    void runner.scanOnce().catch(error => console.error("Scan failed", error));
  }, config.pollIntervalMinutes * 60_000);
  interval.unref();

  try {
    console.info("JobHunter started; HH auto-applications are not active.");
    void runner.scanOnce().catch(error => console.error("Initial scan failed", error));
    await runBot(db, tg, config, abort.signal);
  } finally {
    clearInterval(interval);
    await db.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
