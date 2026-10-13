import { XMLParser } from "fast-xml-parser";
import { Job, stripHtml } from "./core.js";

export interface JobSource {
  name: "remotive" | "wwr";
  cooldownMs: number;
  fetchJobs(): Promise<Job[]>;
}

async function download(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "JobHunter/0.1 (personal non-commercial job feed)" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error("Source returned HTTP " + response.status);
  return response.text();
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export const remotive: JobSource = {
  name: "remotive",
  // Remotive recommends no more than four requests per day.
  cooldownMs: 6 * 60 * 60 * 1000,
  async fetchJobs() {
    const payload: unknown = JSON.parse(await download("https://remotive.com/api/remote-jobs?category=software-dev"));
    if (!payload || typeof payload !== "object" || !("jobs" in payload) || !Array.isArray(payload.jobs)) {
      throw new Error("Unexpected Remotive response");
    }
    return payload.jobs.flatMap((item: unknown): Job[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (!text(row.id) || !text(row.title) || !text(row.url) || !text(row.publication_date)) return [];
      return [{
        source: "remotive",
        externalId: text(row.id),
        title: text(row.title),
        company: text(row.company_name) || "Unknown company",
        url: text(row.url),
        publishedAt: text(row.publication_date),
        description: stripHtml(text(row.description)),
        location: text(row.candidate_required_location) || "Remote"
      }];
    });
  }
};

export const wwr: JobSource = {
  name: "wwr",
  cooldownMs: 15 * 60 * 1000,
  async fetchJobs() {
    const xml = await download("https://weworkremotely.com/categories/remote-programming-jobs.rss");
    const parsed: unknown = new XMLParser({ ignoreAttributes: false }).parse(xml);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid WWR RSS feed");
    const root = parsed as { rss?: { channel?: { item?: unknown } } };
    const items = root.rss?.channel?.item;
    if (!items) return [];
    return (Array.isArray(items) ? items : [items]).flatMap((item: unknown): Job[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const url = text(row.link);
      const originalTitle = stripHtml(text(row.title));
      const colon = originalTitle.indexOf(": ");
      const company = colon >= 0 ? originalTitle.slice(0, colon) : "Unknown company";
      const title = colon >= 0 ? originalTitle.slice(colon + 2) : originalTitle;
      if (!url || !title || !text(row.pubDate)) return [];
      return [{
        source: "wwr",
        externalId: url,
        title,
        company,
        url,
        publishedAt: text(row.pubDate),
        description: stripHtml(text(row.description)),
        location: "Remote"
      }];
    });
  }
};

export const SOURCES: JobSource[] = [remotive, wwr];
