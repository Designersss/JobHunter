import { XMLParser } from "fast-xml-parser";
import { Job, stripHtml } from "./core.js";

export interface JobSource {
  name: "remotive" | "wwr" | "jobicy";
  cooldownMs: number;
  fetchJobs(): Promise<Job[]>;
}

async function download(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "JobHunter/0.2 (personal job feed; source attribution retained)",
      "Accept": "application/json, application/rss+xml, application/xml, text/xml"
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error("Source returned HTTP " + response.status);
  return response.text();
}

function value(input: unknown): string {
  if (typeof input === "string" || typeof input === "number") return String(input);
  if (input && typeof input === "object" && "#text" in input) {
    return value((input as Record<string, unknown>)["#text"]);
  }
  return "";
}

function object(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : null;
}

export function parseRemotive(payload: unknown): Job[] {
  const root = object(payload);
  if (!Array.isArray(root?.jobs)) throw new Error("Unexpected Remotive response");
  return root.jobs.flatMap((item: unknown): Job[] => {
    const row = object(item);
    if (!row || !value(row.id) || !value(row.title) ||
      !value(row.url) || !value(row.publication_date)) return [];
    return [{
      source: "remotive", externalId: value(row.id), title: value(row.title),
      company: value(row.company_name) || "Unknown company", url: value(row.url),
      publishedAt: value(row.publication_date),
      description: stripHtml(value(row.description)),
      location: value(row.candidate_required_location) || "Remote"
    }];
  });
}

export function parseWwr(xml: string): Job[] {
  const root = object(new XMLParser({ ignoreAttributes: false }).parse(xml));
  const rss = object(root?.rss);
  const channel = object(rss?.channel);
  if (!channel || !("item" in channel)) throw new Error("WWR RSS has no item field");
  const entries = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
  return entries.flatMap((item: unknown): Job[] => {
    const row = object(item);
    if (!row) return [];
    const url = value(row.link);
    const originalTitle = stripHtml(value(row.title));
    const splitAt = originalTitle.indexOf(": ");
    const company = splitAt >= 0 ? originalTitle.slice(0, splitAt) : "Unknown company";
    const title = splitAt >= 0 ? originalTitle.slice(splitAt + 2) : originalTitle;
    if (!url || !title || !value(row.pubDate)) return [];
    return [{
      source: "wwr", externalId: value(row.guid) || url,
      title, company, url, publishedAt: value(row.pubDate),
      description: stripHtml(value(row.description)),
      location: value(row.region) || "Remote"
    }];
  });
}

export function parseJobicy(payload: unknown): { jobs: Job[]; cursor: string | null } {
  const root = object(payload);
  if (!root || !Array.isArray(root.jobs) || root.success === false) {
    throw new Error("Unexpected Jobicy response");
  }
  const jobs = root.jobs.flatMap((item: unknown): Job[] => {
    const row = object(item);
    if (!row || !value(row.id) || !value(row.url) ||
      !value(row.jobTitle) || !value(row.pubDate)) return [];
    return [{
      source: "jobicy", externalId: value(row.id), title: value(row.jobTitle),
      company: value(row.companyName) || "Unknown company", url: value(row.url),
      publishedAt: value(row.pubDate),
      description: stripHtml(value(row.jobExcerpt) || value(row.jobDescription)),
      location: value(row.jobGeo) || "Remote"
    }];
  });
  return { jobs, cursor: typeof root.nextCursor === "string" && root.nextCursor ? root.nextCursor : null };
}

export const remotive: JobSource = {
  name: "remotive",
  cooldownMs: 6 * 60 * 60 * 1000,
  async fetchJobs() {
    return parseRemotive(JSON.parse(await download(
      "https://remotive.com/api/remote-jobs?category=software-dev"
    )) as unknown);
  }
};

export const wwr: JobSource = {
  name: "wwr",
  cooldownMs: 15 * 60 * 1000,
  async fetchJobs() {
    return parseWwr(await download(
      "https://weworkremotely.com/categories/remote-programming-jobs.rss"
    ));
  }
};

export const jobicy: JobSource = {
  name: "jobicy",
  // Jobicy expressly requires at least one hour between synchronization passes.
  cooldownMs: 60 * 60 * 1000,
  async fetchJobs() {
    const jobs: Job[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const url = new URL("https://jobicy.com/api/v2/remote-jobs");
      url.searchParams.set("count", "200");
      url.searchParams.set("industry", "engineering");
      if (cursor) url.searchParams.set("cursor", cursor);
      const parsed = parseJobicy(JSON.parse(await download(url.toString())) as unknown);
      jobs.push(...parsed.jobs);
      cursor = parsed.cursor;
      if (!cursor) return jobs;
      if (seen.has(cursor)) throw new Error("Jobicy returned a repeated cursor");
      seen.add(cursor);
    }
    throw new Error("Jobicy pagination exceeded 10 pages; refusing incomplete scan");
  }
};

export const SOURCES: JobSource[] = [remotive, wwr, jobicy];
