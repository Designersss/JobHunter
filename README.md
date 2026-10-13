# JobHunter

TypeScript service for a **private Telegram job feed**. Finds newly published remote Frontend/React/TypeScript/Fullstack roles, stores them in PostgreSQL, sends each unique vacancy to your private channel once, and exposes read-only statistics and pause/resume controls through a private Telegram bot.

> **Phase 1 only.** Automated hh.ru applications are not implemented or enabled. No OpenAI or other AI service. No employer-message monitoring.

## What works today

- Remotive API (polled at most every 6 hours, with explicit Remotive attribution and original link).
- We Work Remotely public programming RSS (polled every 15 minutes).
- Exact 72-hour publication window, including expiration of jobs that grow stale while waiting in the queue, title-based tech-role matching, exclusion of junior/internship titles.
- PostgreSQL uniqueness on canonicalized source URL **and** source vacancy ID. After a successful post, it will not be reposted after restart.
- Atomic queue claiming for concurrent workers, with conservative uncertain state on interrupted/ambiguous Telegram delivery. Uncertain posts are **not automatically resent**.
- Telegram commands: /start, /help, /stats, /recent, /sources, /pause, /resume. Only the owner ID is allowed.
- No automatic replies, interviews or invitation tracking.

Cross-source deduplication is exact-URL based in this phase, not fuzzy company/title matching. Third-party aggregators often use different URLs for the same job; this will be addressed in a separate phase.

## Setup

Prerequisites: Node.js 22+, Docker (for local PostgreSQL), a private Telegram channel, and a Telegram bot created via @BotFather.

1. Add the bot as an administrator **with permission to post** to the private channel.
2. Start a private conversation with the bot, send /start, and determine your numeric Telegram user ID plus the channel's -100... ID.
3. Copy .env.example to .env and fill TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID, TELEGRAM_CHANNEL_ID. **Never commit .env.**
4. Start the database with: docker compose up -d
5. Install dependencies: npm install
6. Verify: npm run typecheck && npm test && npm run build
7. Run: npm run dev (development) or npm start after build.

The first scan runs at process startup; later scans use POLL_INTERVAL_MINUTES (default 15). Remotive is intentionally fetched no more than four times a day per deployment. On startup, any prior job left in a sending state is marked uncertain to avoid duplicate posting after an ambiguous network failure.

Commands are available in the private chat with your bot, not in the channel. The bot will **not** send unsolicited status or employer-response notifications.

## Operating notes

- Grant the bot access only to a private channel and restrict command handling to your own numeric Telegram user ID.
- In this phase you cannot automatically reconcile Telegram messages marked uncertain. Inspect the channel and database before deciding whether to reset a record.
- The service is intended to run as **one instance**. Database job claiming is atomic, but Telegram long polling and per-provider poll cooldowns assume a single running process.
- Published vacancies are kept indefinitely to prevent repeat postings; keep backups of the PostgreSQL volume.
- The worker never uses captchas, impersonation, unauthorized site automation, or private employer APIs.
- External publishers' feeds may be delayed; the 72-hour window is measured using each vacancy's supplied publication time.
- Public sites might change their feed shape. Failed source pulls are logged and visible using /sources.
- Publishing all backlog immediately would flood the channel, so MAX_TELEGRAM_POSTS_PER_CYCLE defaults to 25.

## Roadmap

1. Foundation (this PR): Telegram channel, Remotive + WWR, PostgreSQL, dedupe, tests/CI.
2. hh.ru OAuth and vacancies ingestion, with 72-hour window and verified API permissions.
3. Separate, explicitly enabled HH application worker: resume selection, templated cover letter, idempotency, rate limits and truthful delivery statuses.
4. More source adapters (Jobicy, Arbeitnow, other permitted public feeds), with per-source frequency/terms.
5. Cross-source canonical employer-vacancy dedupe, admin pagination and operational reliability.

Documentation: [Remotive API](https://remotive.com/remote-jobs/api), [WWR RSS](https://weworkremotely.com/remote-job-rss-feed), [HH API](https://api.hh.ru/openapi/redoc).
