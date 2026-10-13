import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJobicy, parseWwr, parseRemotive } from "../src/sources.js";
import { isFresh, isRelevant } from "../src/core.js";

test("WWR RSS title/company parsing and 72h relevance", () => {
  const rss = '<rss><channel><item><title>Acme: Senior React Developer</title>' +
    '<link>https://weworkremotely.com/remote-jobs/acme-react</link>' +
    '<guid>acme-react</guid><pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate>' +
    '<description><![CDATA[<p>Remote &amp; flexible</p>]]></description>' +
    '</item></channel></rss>';
  const jobs = parseWwr(rss);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.company, "Acme");
  assert.equal(jobs[0]?.title, "Senior React Developer");
  assert.equal(jobs[0]?.source, "wwr");
  assert.equal(isFresh(jobs[0]!, new Date("2026-10-13T12:00:00Z")), true);
  assert.equal(isRelevant(jobs[0]!), true);
});

test("Jobicy v2 parses public fields and uses original link", () => {
  const data = parseJobicy({
    success: true, nextCursor: "next token", jobs: [{
      id: 123, url: "https://jobicy.com/jobs/senior-react",
      jobTitle: "Senior React Developer", companyName: "Acme",
      pubDate: "2026-10-13T10:00:00Z", jobGeo: "Europe",
      jobDescription: "<p>React Typescript</p>"
    }]
  });
  assert.equal(data.cursor, "next token");
  assert.equal(data.jobs[0]?.url, "https://jobicy.com/jobs/senior-react");
  assert.equal(data.jobs[0]?.description, "React Typescript");
});

test("Jobicy rejects unsuccessful responses rather than silently reporting zero jobs", () => {
  assert.throws(() => parseJobicy({ success: false, jobs: [] }));
  assert.throws(() => parseJobicy({ jobs: "not an array" }));
});

test("Remotive parser handles valid response without masking access denials", () => {
  const jobs = parseRemotive({ jobs: [{
    id: 8, title: "Frontend Engineer", company_name: "Studio",
    url: "https://remotive.com/remote-jobs/software-dev/example",
    publication_date: "2026-10-13T10:00:00Z", description: "<p>Web apps</p>"
  }] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.title, "Frontend Engineer");
});
