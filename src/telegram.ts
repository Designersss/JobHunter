import { Config } from "./config.js";

interface TgEnvelope<T> {
  ok: boolean;
  description?: string;
  result?: T;
}
interface TgMessage { message_id: number }
interface TgUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number }; from?: { id: number } };
}

export class Telegram {
  constructor(private readonly config: Config) {}

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(
      "https://api.telegram.org/bot" + this.config.telegramToken + "/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(35_000)
      }
    );
    const data: TgEnvelope<T> = await response.json() as TgEnvelope<T>;
    if (!response.ok || !data.ok || data.result === undefined) {
      throw new Error("Telegram " + method + ": " + (data.description || response.status));
    }
    return data.result;
  }

  async post(html: string): Promise<number> {
    const sent = await this.call<TgMessage>("sendMessage", {
      chat_id: this.config.telegramChannelId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true }
    });
    return sent.message_id;
  }

  async reply(chatId: number, message: string): Promise<void> {
    await this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text: message,
      link_preview_options: { is_disabled: true }
    });
  }

  async updates(offset: number): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>("getUpdates", {
      offset, timeout: 20, allowed_updates: ["message"], limit: 50
    });
  }
}
