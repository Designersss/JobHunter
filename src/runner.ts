import { Database } from "./database.js";
import { isFresh, isRelevant, formatJob } from "./core.js";
import { JobSource } from "./sources.js";
import { Telegram } from "./telegram.js";

export class Runner {
  private scanning = false;
  constructor(
    private readonly db: Database,
    private readonly telegram: Telegram,
    private readonly sources: JobSource[],
    private readonly maxPostsPerCycle: number
  ) {}

  async scanOnce(): Promise<void> {
    if (this.scanning || await this.db.paused()) return;
    this.scanning = true;
    try {
      for (const source of this.sources) {
        if (!await this.db.sourceDue(source.name, source.cooldownMs)) continue;
        try {
          const jobs = await source.fetchJobs();
          let fresh = 0;
          let matched = 0;
          let saved = 0;
          for (const job of jobs) {
            if (!isFresh(job)) continue;
            fresh++;
            if (!isRelevant(job)) continue;
            matched++;
            if (await this.db.saveJob(job)) saved++;
          }
          await this.db.sourceAttempt(source.name, undefined, {
            fetched: jobs.length, fresh, matched, saved
          });
          console.info("Source", source.name, {
            fetched: jobs.length, fresh, matched, new: saved,
            excludedByDate: jobs.length - fresh,
            excludedByRole: fresh - matched,
            duplicates: matched - saved
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.db.sourceAttempt(source.name, message);
          console.error("Source failed:", source.name, message);
        }
      }
      // Some jobs can become older than 72h while waiting in the backlog.
      await this.db.expireQueued();
      for (let sent = 0; sent < this.maxPostsPerCycle; sent++) {
        if (await this.db.paused()) break;
        const job = await this.db.claimNext();
        if (!job) break;
        try {
          const messageId = await this.telegram.post(formatJob(job));
          await this.db.markSent(job.id, messageId);
        } catch (error) {
          // A network failure after the Telegram send can be ambiguous.
          // Never blindly retry: require manual reconciliation.
          const message = error instanceof Error ? error.message : String(error);
          await this.db.markUncertain(job.id, message);
          console.error("Telegram send requires review for job", job.id, message);
          break;
        }
      }
    } finally {
      this.scanning = false;
    }
  }
}
