export type SourceName = "remotive" | "wwr";

export interface Job {
  source: SourceName;
  externalId: string;
  title: string;
  company: string;
  url: string;
  publishedAt: string;
  description: string;
  location: string;
}

export interface StoredJob extends Job {
  id: string;
  status: "queued" | "sending" | "sent" | "uncertain";
}

const ROLE = /(front[\s-]?end|full[\s-]?stack|react|typescript|javascript|next\.?js|web developer)/i;
const EXCLUDED = /\b(junior|intern(ship)?|trainee|graduate)\b|стаж[её]р|младший разработчик/i;

export function isRelevant(job: Job): boolean {
  return ROLE.test(job.title) && !EXCLUDED.test(job.title);
}

export function isFresh(job: Job, now = new Date(), hours = 72): boolean {
  const timestamp = Date.parse(job.publishedAt);
  return Number.isFinite(timestamp) &&
    timestamp >= now.getTime() - hours * 60 * 60 * 1000 &&
    timestamp <= now.getTime() + 5 * 60 * 1000;
}

export function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Unsupported job URL protocol");
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|yclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function formatJob(job: Job): string {
  const description = stripHtml(job.description).slice(0, 650);
  return [
    "<b>" + escapeHtml(job.title) + "</b>",
    escapeHtml(job.company),
    "Source: " + escapeHtml(job.source),
    "Location: " + escapeHtml(job.location || "Not specified"),
    "Published: " + escapeHtml(job.publishedAt),
    description ? "\n" + escapeHtml(description) : "",
    '\n<a href="' + escapeHtml(job.url) + '">Open vacancy</a>'
  ].filter(Boolean).join("\n");
}
