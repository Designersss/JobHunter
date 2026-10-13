# HH-01: applicant OAuth + vacancy discovery

This stage is **read-only with respect to hh.ru**. It obtains OAuth access, lists your
resumes, and discovers vacancies published within the last 72 hours. It writes
the discovered vacancy metadata to the local PostgreSQL database; it does not
submit applications, messages, or invitations.

1. Register your own application at https://dev.hh.ru/ using callback
   `http://127.0.0.1:8765/callback` (or configure another local callback).
2. Add `HH_CLIENT_ID`, `HH_CLIENT_SECRET`, `HH_REDIRECT_URI` and
   `HH_USER_AGENT=JobHunter/0.2 (your-real-contact@example.com)` to your
   **local** `.env` only. Never paste your secret into GitHub, Telegram,
   screenshots, or chat.
3. Run `npm run hh:auth`. Open the printed authorization URL in your Mac
   browser and approve access. Credentials are saved locally at
   `.secrets/hh-token.json` (ignored by Git, file mode 0600).
4. Run `npm run hh:resumes` to list your available resume IDs.
5. Run `npm run hh:scan`. This performs a read-only (to hh.ru) 72-hour scan
   and saves vacancy IDs/links, publication dates and whether the resume has
   already responded if returned in the search data.

Search parameters:
- `HH_SEARCH_TEXT=` and `HH_AREA=` empty => broad search, not restricted
  to Frontend or any profession. No AI filtering, no automatic HH applications.
- `HH_MAX_REQUESTS=80` limits API usage. Large searches may fail with
  an explicit "incomplete" error; increase the limit or narrow the query/area.
- HH limits search pagination to 2000 vacancies per query; the client recursively
  divides the 72h interval to avoid silent truncation. HH rounds date filters
  to five-minute boundaries, so very dense windows may still require area
  or text partitioning. The client aborts rather than invent completeness.
- The HTTP client retries read-only GET requests on 429/5xx with bounded backoff.
  Token refreshing uses the single-use HH refresh token only after the access
  token has expired, following the provider's rules.

**Limitations:** Applicant access depends on HH permissions and API availability.
No automatic response worker is present; HH-02 will introduce explicit
opt-in, individual application records, idempotency, status reconciliation,
template letters and per-account limits.

Official documentation: https://api.hh.ru/openapi/redoc.
