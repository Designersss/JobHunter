import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertCallback, authorizationUrl, createVerifier, HhOAuthConfig } from "../src/hh/auth.js";
import { hhDate, normalizeVacancy, searchHh } from "../src/hh/discovery.js";
import type { GetJson } from "../src/hh/api.js";

const config: HhOAuthConfig = {
  clientId: "example", clientSecret: "secret", userAgent: "Test/1.0 (test@example.com)",
  redirectUri: "http://127.0.0.1:8765/callback", tokenFile: ".secrets/test.json"
};

test("HH OAuth PKCE URL and state validation", () => {
  const verifier = createVerifier();
  const url = new URL(authorizationUrl(config, "state1", verifier));
  assert.equal(url.origin, "https://hh.ru");
  assert.equal(url.searchParams.get("code_challenge"),
    createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(assertCallback(new URL("http://127.0.0.1:8765/callback?state=state1&code=abc"), "state1"), "abc");
  assert.throws(() =>
    assertCallback(new URL("http://127.0.0.1:8765/callback?state=wrong&code=abc"), "state1"));
});

const now = new Date("2026-10-13T12:00:00.000Z");
const vacancy = (id: string, date: string) => ({
  id, name: "React Developer", published_at: date,
  alternate_url: "https://hh.ru/vacancy/" + id,
  relations: id === "1" ? ["got_response"] : []
});

test("HH date formatting is ISO8601 offset format", () => {
  assert.equal(hhDate(now), "2026-10-13T12:00:00+0000");
  assert.equal(normalizeVacancy(vacancy("1", now.toISOString()))?.id, "1");
  assert.equal(normalizeVacancy({ ...vacancy("1", now.toISOString()), alternate_url: "javascript:alert(1)" }), null);
});

test("HH discovery pages, removes duplicates, and checks exact 72h", async () => {
  const called: string[] = [];
  const get: GetJson = async <T>(path: string, parameters?: URLSearchParams): Promise<T> => {
    assert.equal(path, "/vacancies");
    called.push(parameters?.get("page") || "");
    return {
      found: 102, pages: 2, items: parameters?.get("page") === "0" ?
        [vacancy("1", now.toISOString()), vacancy("2", "2026-10-10T11:00:00Z")] :
        [vacancy("1", now.toISOString()), vacancy("3", now.toISOString())]
    } as T;
  };
  const scan = await searchHh(get, { now, maxRequests: 4 });
  assert.deepEqual(called, ["0", "1"]);
  assert.deepEqual(scan.vacancies.map(v => v.id), ["1", "3"]);
  assert.equal(scan.rejectedByDate, 1);
  assert.equal(scan.alreadyApplied, 1);
});

test("HH discovery splits a large result window and does not silently truncate", async () => {
  const get: GetJson = async <T>(_path: string, params?: URLSearchParams): Promise<T> => {
    const from = Date.parse(params!.get("date_from")!.replace("+0000", "Z"));
    const to = Date.parse(params!.get("date_to")!.replace("+0000", "Z"));
    return { found: to - from > 3_600_000 ? 2500 : 0,
      pages: to - from > 3_600_000 ? 20 : 0, items: [] } as T;
  };
  const result = await searchHh(get, { now, maxRequests: 200 });
  assert.ok(result.windows > 2);
  assert.equal(result.vacancies.length, 0);
});

test("HH discovery fails closed on request budget", async () => {
  const get: GetJson = async <T>(): Promise<T> => ({ found: 3000, pages: 20, items: [] } as T);
  await assert.rejects(searchHh(get, { now, maxRequests: 3 }), /budget exceeded/);
});
