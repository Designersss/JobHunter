import { accessToken, HhOAuthConfig } from "./auth.js";

export class HhRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HhRequestError";
  }
}

export type GetJson = <T>(path: string, parameters?: URLSearchParams) => Promise<T>;

export function hhClient(config: HhOAuthConfig): GetJson {
  return async <T>(path: string, parameters?: URLSearchParams): Promise<T> => {
    const url = new URL(path, "https://api.hh.ru");
    if (url.origin !== "https://api.hh.ru" || !url.pathname.startsWith("/")) {
      throw new Error("External API URLs are not permitted");
    }
    if (parameters) url.search = parameters.toString();
    const token = await accessToken(config);
    for (let attempt = 0; attempt < 4; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: "Bearer " + token, "HH-User-Agent": config.userAgent },
          signal: AbortSignal.timeout(20_000)
        });
      } catch {
        if (attempt === 3) throw new Error("HH API network unavailable");
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      if (response.ok) return await response.json() as T;
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryHeader = response.headers.get("Retry-After");
        const retrySeconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : 0;
        const delay = Math.min(30_000, Math.max(500 * 2 ** attempt, retrySeconds * 1000));
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw new HhRequestError(response.status,
        "HH API GET " + url.pathname + " failed with HTTP " + response.status);
    }
    throw new Error("HH API GET exhausted retries");
  };
}
