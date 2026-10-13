import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/database.js";
import { Job } from "../src/core.js";

test("Postgres uniqueness, atomic claiming, and queue expiry", {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const db = new Database(process.env.TEST_DATABASE_URL!);
  try {
    await db.init();
    const id = randomUUID();
    const job: Job = {
      source: "remotive", externalId: id, title: "React Developer",
      company: "Test", url: "https://example.com/jobs/" + id,
      publishedAt: new Date().toISOString(),
      description: "Frontend engineering", location: "Remote"
    };
    assert.equal(await db.saveJob(job), true);
    assert.equal(await db.saveJob(job), false);
    assert.equal(await db.saveJob({ ...job, source: "wwr", externalId: id + "-alt" }), false);

    const oldId = randomUUID();
    await db.saveJob({
      ...job, externalId: oldId, url: "https://example.com/jobs/" + oldId,
      publishedAt: new Date(Date.now() - 74 * 60 * 60 * 1000).toISOString()
    });
    await db.expireQueued();

    const [claimed, competing] = await Promise.all([db.claimNext(), db.claimNext()]);
    const picked = claimed ?? competing;
    assert.ok(picked);
    assert.equal(picked.externalId, id);
    assert.equal([claimed, competing].filter(Boolean).length, 1);

    await db.markSent(picked.id, 1234);
    const stats = await db.statistics();
    assert.ok(stats.sent >= 1);
    assert.ok(stats.expired >= 1);
    assert.equal((await db.recent()).some(x => x.url === job.url), true);
  } finally {
    await db.close();
  }
});
