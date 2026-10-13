import "dotenv/config";
import { authorizeLocally, configFromEnv } from "./auth.js";
import { hhClient } from "./api.js";
import { searchHh } from "./discovery.js";
import { Database } from "../database.js";

async function main(): Promise<void> {
  const action = process.argv[2];
  if (!["auth", "resumes", "scan"].includes(action || "")) {
    throw new Error("Usage: npm run hh:auth | npm run hh:resumes | npm run hh:scan");
  }
  const config = configFromEnv();
  if (action === "auth") {
    await authorizeLocally(config);
    return;
  }
  const get = hhClient(config);
  if (action === "resumes") {
    const raw = await get<{ items: unknown[] }>("/resumes/mine");
    if (!raw || !Array.isArray(raw.items)) throw new Error("Malformed resume list");
    const rows = raw.items.flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      if (typeof value.id !== "string") return [];
      return [{ id: value.id, title: String(value.title || "Untitled") }];
    });
    console.log("Available HH resumes:");
    for (const row of rows) console.log(row.id + " — " + row.title);
    return;
  }
  const maxRequests = Number(process.env.HH_MAX_REQUESTS || "80");
  const scan = await searchHh(get, {
    now: new Date(), maxRequests,
    ...(process.env.HH_AREA?.trim() ? { area: process.env.HH_AREA.trim() } : {}),
    ...(process.env.HH_SEARCH_TEXT?.trim() ? { text: process.env.HH_SEARCH_TEXT.trim() } : {})
  });
  // Persist a completed scan only; an aborted or capped scan must not be
  // silently presented as exhaustive.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("Missing DATABASE_URL");
  const db = new Database(dbUrl);
  try {
    await db.init();
    const inserted = await db.saveHhVacancies(scan.vacancies);
    console.log(JSON.stringify({
      searchedLastHours: 72,
      totalUnique: scan.vacancies.length,
      newSaved: inserted, requests: scan.requests,
      windows: scan.windows, alreadyApplied: scan.alreadyApplied,
      rejectedByDate: scan.rejectedByDate
    }, null, 2));
    for (const item of scan.vacancies.slice(0, 10)) {
      console.log(item.name + " — " + (item.alternate_url || "https://hh.ru/vacancy/" + item.id));
    }
    console.log("READ-ONLY DRY RUN: zero HH applications were submitted.");
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error("HH command failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
