import pg from "pg";
import { canonicalUrl, Job, StoredJob } from "./core.js";

const { Pool } = pg;

export class Database {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async init(): Promise<void> {
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS jobs (" +
      "id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, " +
      "dedupe_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, company TEXT NOT NULL, " +
      "url TEXT NOT NULL, published_at TIMESTAMPTZ NOT NULL, " +
      "description TEXT NOT NULL, location TEXT NOT NULL, discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(), " +
      "status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','uncertain')), " +
      "telegram_message_id BIGINT, last_error TEXT, " +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(source, external_id))"
    );
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS jobs_status_published_idx ON jobs(status,published_at DESC)"
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS source_runs (" +
      "source TEXT PRIMARY KEY, last_attempt_at TIMESTAMPTZ NOT NULL, " +
      "last_success_at TIMESTAMPTZ, last_status TEXT NOT NULL, last_error TEXT)"
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS hh_applications (" +
      "vacancy_id TEXT PRIMARY KEY, vacancy_url TEXT NOT NULL, " +
      "resume_id TEXT, status TEXT NOT NULL, " +
      "last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), " +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    );
    // A crashed sender may have posted successfully. Never blindly resend it.
    await this.pool.query(
      "UPDATE jobs SET status='uncertain', last_error='Interrupted while sending; manual review needed', " +
      "updated_at=now() WHERE status='sending'"
    );
  }

  async saveJob(job: Job): Promise<boolean> {
    const url = canonicalUrl(job.url);
    const result = await this.pool.query(
      "INSERT INTO jobs (source,external_id,dedupe_key,title,company,url,published_at,description,location) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id",
      [job.source, job.externalId, url, job.title, job.company, job.url,
        job.publishedAt, job.description, job.location]
    );
    return result.rowCount === 1;
  }

  async sourceDue(source: string, cooldownMs: number): Promise<boolean> {
    const result = await this.pool.query<{ last_attempt_at: Date }>(
      "SELECT last_attempt_at FROM source_runs WHERE source=$1", [source]
    );
    const last = result.rows[0]?.last_attempt_at;
    return !last || Date.now() - last.getTime() >= cooldownMs;
  }

  async sourceAttempt(source: string, error?: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO source_runs(source,last_attempt_at,last_success_at,last_status,last_error) " +
      "VALUES ($1,now(),CASE WHEN $2::text IS NULL THEN now() ELSE NULL END, " +
      "CASE WHEN $2::text IS NULL THEN 'ok' ELSE 'error' END,$2) " +
      "ON CONFLICT(source) DO UPDATE SET " +
      "last_attempt_at=now(),last_success_at=CASE WHEN EXCLUDED.last_status='ok' THEN now() " +
      "ELSE source_runs.last_success_at END,last_status=EXCLUDED.last_status,last_error=EXCLUDED.last_error",
      [source, error ?? null]
    );
  }

  async claimNext(): Promise<StoredJob | null> {
    const result = await this.pool.query(
      "WITH next_job AS (SELECT id FROM jobs WHERE status='queued' " +
      "ORDER BY published_at DESC,id FOR UPDATE SKIP LOCKED LIMIT 1) " +
      "UPDATE jobs SET status='sending',updated_at=now() WHERE id=(SELECT id FROM next_job) " +
      "RETURNING id::text,source,external_id,title,company,url,published_at,description,location,status"
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), source: row.source as Job["source"],
      externalId: String(row.external_id), title: String(row.title),
      company: String(row.company), url: String(row.url),
      publishedAt: (row.published_at as Date).toISOString(),
      description: String(row.description), location: String(row.location),
      status: "sending"
    };
  }

  async markSent(id: string, messageId: number): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status='sent',telegram_message_id=$2,last_error=NULL,updated_at=now() " +
      "WHERE id=$1 AND status='sending'", [id, messageId]
    );
  }

  async markUncertain(id: string, error: string): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status='uncertain',last_error=$2,updated_at=now() " +
      "WHERE id=$1 AND status='sending'", [id, error.slice(0, 1000)]
    );
  }

  async setting(key: string): Promise<string | null> {
    const result = await this.pool.query<{ value: string }>(
      "SELECT value FROM settings WHERE key=$1", [key]
    );
    return result.rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO settings(key,value) VALUES($1,$2) " +
      "ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [key, value]
    );
  }

  async paused(): Promise<boolean> {
    return (await this.setting("paused")) === "true";
  }

  async statistics(): Promise<{ total: number; sent: number; queued: number; uncertain: number }> {
    const result = await this.pool.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='sent')::int AS sent, " +
      "COUNT(*) FILTER(WHERE status='queued')::int AS queued, " +
      "COUNT(*) FILTER(WHERE status='uncertain')::int AS uncertain FROM jobs"
    );
    const row = result.rows[0] as { total: number; sent: number; queued: number; uncertain: number };
    return row;
  }

  async recent(): Promise<Array<{ title: string; source: string; url: string }>> {
    const result = await this.pool.query<{ title: string; source: string; url: string }>(
      "SELECT title,source,url FROM jobs WHERE status='sent' " +
      "ORDER BY updated_at DESC LIMIT 10"
    );
    return result.rows;
  }

  async sourceStatuses(): Promise<Array<{ source: string; last_status: string; last_attempt_at: Date }>> {
    const result = await this.pool.query<{ source: string; last_status: string; last_attempt_at: Date }>(
      "SELECT source,last_status,last_attempt_at FROM source_runs ORDER BY source"
    );
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
