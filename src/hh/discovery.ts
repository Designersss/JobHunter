import { GetJson } from "./api.js";

export interface HhVacancy {
  id: string;
  name: string;
  published_at: string;
  alternate_url: string | null;
  employer?: { name?: string | null } | null;
  relations?: string[];
  has_test?: boolean;
}

interface SearchPage {
  found: number;
  pages: number;
  items: unknown[];
}

export interface SearchOptions {
  now: Date;
  area?: string;
  text?: string;
  maxRequests: number;
}

export interface SearchReport {
  vacancies: HhVacancy[];
  requests: number;
  windows: number;
  rejectedByDate: number;
  alreadyApplied: number;
}

export function hhDate(date: Date): string {
  return date.toISOString().slice(0, 19) + "+0000";
}

export function normalizeVacancy(raw: unknown): HhVacancy | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string" ||
    typeof row.published_at !== "string") return null;
  const link = typeof row.alternate_url === "string" ? row.alternate_url : null;
  if (link && !/^https:\/\/(hh\.ru|[^/]+\.hh\.ru)\/vacancy\/\d+(?:[/?#]|$)/.test(link)) {
    return null;
  }
  const employer = row.employer && typeof row.employer === "object"
    ? row.employer as { name?: string | null } : null;
  return {
    id: row.id, name: row.name, published_at: row.published_at,
    alternate_url: link,
    ...(employer && typeof employer.name === "string" ? { employer: { name: employer.name } } : {}),
    ...(Array.isArray(row.relations) ? {
      relations: row.relations.filter((item): item is string => typeof item === "string")
    } : {}),
    ...(typeof row.has_test === "boolean" ? { has_test: row.has_test } : {})
  };
}

export async function searchHh(
  get: GetJson, options: SearchOptions
): Promise<SearchReport> {
  if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) {
    throw new Error("maxRequests must be a positive integer");
  }
  const seen = new Map<string, HhVacancy>();
  let requests = 0;
  let windows = 0;
  let rejectedByDate = 0;
  const minimum = options.now.getTime() - 72 * 60 * 60 * 1000;
  const maximum = options.now.getTime();

  async function page(from: number, to: number, index: number): Promise<SearchPage> {
    if (++requests > options.maxRequests) {
      throw new Error("HH scan request budget exceeded. Results are incomplete; no scan is persisted.");
    }
    const params = new URLSearchParams({
      host: "hh.ru", per_page: "100", page: String(index),
      date_from: hhDate(new Date(from)), date_to: hhDate(new Date(to)),
      order_by: "publication_time"
    });
    if (options.area) params.set("area", options.area);
    if (options.text) params.set("text", options.text);
    const data = await get<unknown>("/vacancies", params);
    if (!data || typeof data !== "object" ||
      !("found" in data) || !("pages" in data) || !("items" in data)) {
      throw new Error("Malformed HH vacancy search response");
    }
    const row = data as { found: unknown; pages: unknown; items: unknown };
    if (typeof row.found !== "number" || !Number.isInteger(row.found) ||
      typeof row.pages !== "number" || !Number.isInteger(row.pages) ||
      !Array.isArray(row.items)) {
      throw new Error("Malformed HH vacancy pagination metadata");
    }
    return { found: row.found, pages: row.pages, items: row.items };
  }

  function collect(items: unknown[]): void {
    for (const item of items) {
      const vacancy = normalizeVacancy(item);
      if (!vacancy) continue;
      const timestamp = Date.parse(vacancy.published_at);
      if (!Number.isFinite(timestamp) || timestamp < minimum || timestamp > maximum) {
        rejectedByDate++;
        continue;
      }
      if (!seen.has(vacancy.id)) seen.set(vacancy.id, vacancy);
    }
  }

  async function window(from: number, to: number): Promise<void> {
    windows++;
    const first = await page(from, to, 0);
    // HH's search pagination stops at 2000 results. Split time intervals
    // rather than silently claiming to have searched all results.
    if (first.found > 2000 || first.pages > 20) {
      // HH rounds request timestamps to five minutes, so finer splits
      // become unreliable and must be reported rather than silently truncated.
      if (to - from <= 15 * 60 * 1000) {
        throw new Error("HH query exceeds 2000 results in a narrow time window; " +
          "narrow by area or text. Search was incomplete.");
      }
      const midpoint = Math.floor((from + to) / 2 / 300_000) * 300_000;
      if (midpoint <= from || midpoint >= to) throw new Error("HH cannot split search window");
      await window(from, midpoint);
      await window(midpoint, to);
      return;
    }
    collect(first.items);
    const pages = Math.min(first.pages, 20);
    for (let index = 1; index < pages; index++) {
      const next = await page(from, to, index);
      collect(next.items);
    }
  }

  await window(minimum, maximum);
  const vacancies = [...seen.values()].sort((a, b) =>
    Date.parse(b.published_at) - Date.parse(a.published_at));
  return {
    vacancies, requests, windows, rejectedByDate,
    alreadyApplied: vacancies.filter(v => v.relations?.includes("got_response")).length
  };
}
