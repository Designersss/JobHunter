import { Config } from "./config.js";
import { Database } from "./database.js";
import { Telegram } from "./telegram.js";

export async function runBot(db: Database, tg: Telegram, config: Config, signal: AbortSignal): Promise<void> {
  let offset = Number(await db.setting("telegram_offset") || "0");
  let consecutiveErrors = 0;
  while (!signal.aborted) {
    try {
      const updates = await tg.updates(offset);
      consecutiveErrors = 0;
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        const message = update.message;
        // Ignore every message except private commands from the configured owner.
        if (message && String(message.from?.id) === config.telegramOwnerId &&
          String(message.chat.id) === config.telegramOwnerId && message.text?.startsWith("/")) {
          try {
            const command = message.text.split(/\s/)[0]?.split("@")[0] ?? "";
            let response: string;
            switch (command) {
              case "/start":
              case "/help":
                response = "JobHunter\n/stats — feed statistics\n/recent — latest published jobs\n" +
                  "/sources — provider status\n/pause — pause all scanning and posting\n" +
                  "/resume — continue scanning and posting\n" +
                  "HH auto-applications are planned; they are NOT enabled.";
                break;
              case "/stats": {
                const s = await db.statistics();
                const paused = await db.paused();
                response = "JobHunter (" + (paused ? "paused" : "running") + ")\n" +
                  "Unique jobs: " + s.total + "\nPosted: " + s.sent + "\n" +
                  "Queued: " + s.queued + "\nExpired: " + s.expired +
                  "\nNeeds review: " + s.uncertain;
                break;
              }
              case "/recent": {
                const items = await db.recent();
                response = items.length ? items.map((item, index) =>
                  (index + 1) + ". " + item.title + " [" + item.source + "]\n" + item.url
                ).join("\n\n") : "No published vacancies yet.";
                break;
              }
              case "/sources": {
                const rows = await db.sourceStatuses();
                response = rows.length ? rows.map(row =>
                  row.source + ": " + row.last_status + " (" + row.last_attempt_at.toISOString() + ")" +
                  (row.last_error ? "\n  Error: " + row.last_error : "") +
                  (row.last_status === "ok" ? "\n  Fetched: " + row.fetched +
                    ", fresh (72h): " + row.fresh + ", role matched: " + row.matched +
                    ", new: " + row.new_jobs : "")
                ).join("\n\n") : "No providers checked yet.";
                break;
              }
              case "/pause":
                await db.setSetting("paused", "true");
                response = "Scanning and posting paused.";
                break;
              case "/resume":
                await db.setSetting("paused", "false");
                response = "Scanning and posting resumed.";
                break;
              default:
                response = "Unknown command. Use /help.";
            }
            await tg.reply(message.chat.id, response);
          } catch (error) {
            console.error("Command failed", error);
          }
        }
        // Store each consumed offset, including rejected/non-owner commands.
        await db.setSetting("telegram_offset", String(offset));
      }
    } catch (error) {
      if (signal.aborted) return;
      consecutiveErrors++;
      const delay = Math.min(30_000, 2_000 * 2 ** Math.min(consecutiveErrors - 1, 4));
      // getUpdates is a read: retrying is safe and does not repost vacancies.
      console.warn("Telegram polling temporarily unavailable", error instanceof Error ? error.message : String(error),
        "retry in", delay / 1000, "seconds");
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
