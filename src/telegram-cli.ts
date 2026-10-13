import "dotenv/config";
import { canPostToChannel, discoverIds, SetupUpdate } from "./telegram-setup.js";

interface TelegramResult<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

type Method = "getMe" | "getUpdates" | "getChat" | "getChatMember" | "sendMessage" | "getWebhookInfo";

function environment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing " + name + " in your local .env");
  return value;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "discover" && mode !== "check") {
    throw new Error("Usage: npm run telegram:discover | npm run telegram:check [-- --send-test]");
  }
  const token = environment("TELEGRAM_BOT_TOKEN");

  async function api<T>(method: Method, body: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      // Do not print underlying request details that might contain the bot token.
      throw new Error("Telegram connection failed; check your connection and bot token");
    }
    let payload: TelegramResult<T>;
    try {
      payload = await response.json() as TelegramResult<T>;
    } catch {
      throw new Error("Telegram returned a non-JSON response");
    }
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error("Telegram " + method + " failed (" + response.status + "): " +
        (payload.description || "Unknown error"));
    }
    return payload.result;
  }

  const bot = await api<{ id: number; username?: string }>("getMe");
  console.log("Authenticated bot:", bot.username ? "@" + bot.username : "ID " + bot.id);

  if (mode === "discover") {
    const webhook = await api<{ url: string }>("getWebhookInfo");
    if (webhook.url) throw new Error("A webhook is configured; stop it before using getUpdates.");
    // This changes the allowed update types for future updates, but confirms
    // no updates (no offset is supplied). Run this command again after sending
    // /start in the private chat and posting a new message to the channel.
    const updates = await api<SetupUpdate[]>("getUpdates", {
      timeout: 0, limit: 100, allowed_updates: ["message", "channel_post"]
    });
    const found = discoverIds(updates);
    console.log("\nPrivate user IDs:");
    for (const item of found.users) console.log("  " + item.id + " (" + JSON.stringify(item.display) + ")");
    console.log("Channel IDs:");
    for (const item of found.channels) console.log("  " + item.id + " (" + JSON.stringify(item.title) + ")");
    if (found.users.length === 0 || found.channels.length === 0) {
      console.log("\nMissing IDs? Send /start to the bot in a private chat, publish " +
        "a new test post in the channel, then run this command again.");
      console.log("Do not run this command while the JobHunter service is polling Telegram.");
    } else {
      console.log("\nCopy the correct IDs into TELEGRAM_OWNER_ID and TELEGRAM_CHANNEL_ID in .env.");
    }
    return;
  }

  const ownerId = environment("TELEGRAM_OWNER_ID");
  const channelId = environment("TELEGRAM_CHANNEL_ID");

  const chat = await api<{ id: number; type: string; title?: string }>(
    "getChat", { chat_id: channelId }
  );
  if (chat.type !== "channel" || String(chat.id) !== channelId) {
    throw new Error("TELEGRAM_CHANNEL_ID is not a numeric channel ID");
  }
  const member = await api<{ status: string; can_post_messages?: boolean }>(
    "getChatMember", { chat_id: channelId, user_id: bot.id }
  );
  if (!canPostToChannel(member)) {
    throw new Error("Bot must be an administrator with 'Post messages' permission");
  }
  if (!/^\d+$/.test(ownerId)) throw new Error("TELEGRAM_OWNER_ID must be a numeric user ID");

  console.log("Channel found:", JSON.stringify(chat.title || chat.id));
  console.log("Bot has permission to post messages.");
  console.log("Owner ID configured:", ownerId);
  if (process.argv.includes("--send-test")) {
    const sent = await api<{ message_id: number }>("sendMessage", {
      chat_id: channelId, text: "JobHunter setup test: channel publishing is working."
    });
    console.log("Test post published. Telegram message ID:", sent.message_id);
  } else {
    console.log("Read-only check complete. Use npm run telegram:check -- --send-test to test publishing.");
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Unknown setup error");
  process.exitCode = 1;
});
