import { test } from "node:test";
import assert from "node:assert/strict";
import { Job, canonicalUrl, escapeHtml, formatJob, isFresh, isRelevant, stripHtml } from "../src/core.js";
import { loadConfig } from "../src/config.js";

const now = new Date("2026-10-13T12:00:00.000Z");
const job: Job = {
  source: "remotive", externalId: "12", title: "Senior React Developer",
  company: "Example", url: "https://example.com/jobs/12",
  publishedAt: "2026-10-12T12:00:00.000Z",
  description: "<p>React &amp; TS</p>", location: "Remote"
};

test("accepts jobs published within 72 hours", () => {
  assert.equal(isFresh(job, now), true);
  assert.equal(isFresh({ ...job, publishedAt: "2026-10-10T11:59:59.000Z" }, now), false);
});
test("rejects unknown and future publication dates", () => {
  assert.equal(isFresh({ ...job, publishedAt: "nonsense" }, now), false);
  assert.equal(isFresh({ ...job, publishedAt: "2026-10-14T12:00:00.000Z" }, now), false);
});
test("filters developer roles and internships", () => {
  assert.equal(isRelevant(job), true);
  assert.equal(isRelevant({ ...job, title: "Junior React Developer" }), false);
  assert.equal(isRelevant({ ...job, title: "Sales Manager" }), false);
});
test("canonicalizes tracking links", () => {
  assert.equal(canonicalUrl("https://EXAMPLE.COM/jobs/12/?utm_source=abc#details"),
    "https://example.com/jobs/12");
});
test("rejects unsafe URL schemes", () => {
  assert.throws(() => canonicalUrl("javascript:alert(1)"));
});
test("sanitizes Telegram HTML and excerpts", () => {
  assert.equal(stripHtml("<p>A &amp; B</p>"), "A & B");
  assert.equal(escapeHtml('<attack> & "x"'), "&lt;attack&gt; &amp; &quot;x&quot;");
  assert.match(formatJob({ ...job, title: "<evil>" }), /&lt;evil&gt;/);
});
test("rejects invalid numeric configuration", () => {
  const env = { DATABASE_URL: "postgresql://x", TELEGRAM_BOT_TOKEN: "x",
    TELEGRAM_OWNER_ID: "1", TELEGRAM_CHANNEL_ID: "-1001", POLL_INTERVAL_MINUTES: "0" };
  assert.throws(() => loadConfig(env));
});
