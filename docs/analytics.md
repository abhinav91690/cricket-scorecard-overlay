---
type: Service Reference
title: Usage analytics — the collector Worker, D1 and the stats page
description: "The first-party analytics path: what the client sends and when it refuses to, the Cloudflare Worker and its D1 schema, the private stats page, and why the Worker deploy is deliberately manual."
tags: [analytics, cloudflare-worker, d1, privacy, stats]
status: stable
generated: { by: claude/opus-5, at: 2026-09-21T22:32:46Z }
---

# analytics.md — usage analytics

**Load before changing anything under `worker/` or `src/analytics.ts`.**

A tiny first-party collector so we can see which matches, clubs, themes and streaming apps
actually use the overlay. No cookies, no third parties, no persistent identifiers.

---

## 1. The client

`track()` (`src/analytics.ts`) sends to the same-origin `/api/collect` via
`navigator.sendBeacon` **from an idle callback**, so it never touches the first paint or a poll.
It falls back to a `keepalive` fetch and swallows every error.

⚠ **Use `trackOnce()` for anything called from the poll loop.** There is deliberately **no
per-poll event**: the only repeating call is the 5-minute session ping of §5, and every other
event fires at most once per load.

`isTrackingEnabled()` returns false on **localhost**, with **`?debug=`**, with
**`?mode=replay`**, with **`?nostats`**, and when **Do Not Track** is on. Nothing you do locally
is recorded.

⚠ **A LAN IP is not localhost.** Testing from a phone against `http://10.x.x.x:5173` would
report, so use `?debug=1` or `?mode=replay`, which suppress it anyway.

`detectClient()` identifies OBS via the injected `window.obsstudio` object or the
`OBS/<version>` user-agent token, and vMix / Streamlabs / Prism by user agent.

## 2. Events

| Event | When | Recorded |
|---|---|---|
| `overlay_start` | once per page load with a real `matchId` | club ID, match ID, theme, logo, client and version, OS, screen size |
| `home_view` | the home screen is shown | client, OS, screen size |
| `link_stream_submit` | the Link Live Stream form is submitted | club ID, match ID, YouTube video ID, outcome |
| `overlay_ping` | every 5 minutes while a live overlay is on screen, plus a best-effort mark on `pagehide` | session ID, club ID, match ID, theme, client and version, OS, screen size |

⚠ **`overlay_ping` is the one event that does not write to `events`.** It upserts a single row
in `sessions` instead — see §5.

🛑 **Adding an event means adding it to `EVENTS` in `worker/src/collect.ts`** — the Worker
rejects unknown names — **and**, if it needs new columns, a new file in `worker/migrations/`.

## 3. The Worker

Cloudflare proxies `score.abhinav.dev` in front of Netlify. ⚠ **The Worker's `wrangler.toml`
routes claim only `/api/collect` and `/stats*`**; everything else on the domain passes through
to Netlify. Widening those routes would put the Worker in front of the site.

`normalizeEvent()` allow-lists event names, clients and outcomes, requires numeric IDs and caps
string lengths before a single `INSERT` into the D1 `events` table.

Cloudflare's request metadata supplies country, city and colo. A salted `sha256(ip|ua|day)`
gives a per-day distinct-viewer count without identifying anyone — **the salt rotates daily**,
so the hash cannot be joined across days by design.

The D1 database id in `wrangler.toml` is the real one.

## 4. 🛑 The Worker deploy is manual, on purpose

After changing anything under `worker/`, run `npm run deploy` there — and
`npm run db:migrate` first if you added a migration.

`.github/workflows/deploy-worker.yml` exists but **skips itself** until a
`CLOUDFLARE_API_TOKEN` repository secret is added. That is deliberate until the data proves
useful. 🛑 **Do not add the secret without asking.**

Wrangler needs a logged-in session (`npx wrangler login`). See
[deployment.md](./deployment.md) §3 for the corporate-CA problem that makes it fail in a fresh
shell.

## 5. Session length, and what a load count does not tell you

⚠ **About 87% of loads point at matches that had already finished** — people leave a stale
`matchId` in the browser-source field because editing a long URL in a mobile app is awkward. A
load count therefore says how often the overlay was *opened*, not how much it was *used*, which
is what the session ping is for.

### 5a. The 5-minute ping

`startSessionPings()` (`src/analytics.ts`) sets one `setInterval` at **`PING_MS` = 300 s** that
sends `overlay_ping`. `SESSION_ID` is 8 random bytes as 16 hex characters, generated per page
load. The Worker upserts one row per session id in `sessions`; duration is
`last_seen - first_seen`.

🛑 **The heartbeat starts *after* the first successful live `feed.read()`, not beside
`overlay_start`.** `app.ts` calls it in the live branch once the feed has answered. Starting it
at page load would report hours of "use" for a home view or a wrong `matchId` — the opposite of
the question the table exists to answer, given the 87% above.

⚠ **`session_id` is never persisted** — no cookie, no `localStorage`. It groups the pings of one
load and nothing else: it cannot join two loads, follow an operator across days, or be tied to a
person. That is the same property the per-day `visitor` hash was built for, and it is the reason
a session id is acceptable at all here.

### 5b. ⚠ Why 300 s, and what the earlier decision actually said

Session tracking was cut on **3 September** *to keep the collector off the poll path* — a
per-poll event is 12 requests a minute. That rationale is about the poll loop, **not** about an
independent timer, which is why this ping does not contradict it. 🛑 **Do not "re-fix" the 3
September decision by deleting the ping.**

The measured cost, per three-hour match:

| | Pings | Polls |
|---|---|---|
| Requests | 36 | 2,160 |
| Bytes each | 134 | 5,247 (CricClubs response) |

That is **+1.7% of requests and 4.7 KB uploaded** for a whole match — and on the D1 free tier,
**483 writes a day ≈ 0.48%** of the 100k/day allowance at current volumes, about **0.7 MB a
year** of storage. 🛑 **Shortening `PING_MS` invalidates that arithmetic. Re-do it before
changing the interval.**

### 5c. ⚠ Every duration is a floor

Resolution is one ping, so a session's length is measured to its **last ping, not its real
end**: a source destroyed four minutes after a ping reads four minutes short, and a session
under five minutes has no ping at all and reads `<5m` rather than `0m`.

⚠ **`pagehide` is a bonus, never the source of truth.** An OBS browser source does not reliably
fire it when a scene is destroyed or OBS is killed, so the interval is the mechanism and the
final mark is best-effort.

⚠ **A session keeps pinging while the page is open, whether or not the match is live.** "Overlay
hours" therefore includes an overlay left up on a finished match. The club and match id are on
the row, so those sessions can be identified — but the headline number is page-open time.

### 5d. 🛑 Traps in the session SQL

🛑 **`ON CONFLICT` must update `last_seen` and `pings` only.** Touching `first_seen` makes every
duration zero. A mutation that did exactly that **passed the entire mocked Worker suite**, which
is why `worker/src/sessions.test.ts` runs the real statements against real SQLite
(`node:sqlite`). Keep it doing so; the mocked tests cannot see SQL semantics at all.

⚠ **`ROUND` before `CAST`, never `CAST` alone.** `julianday` returns a float, so a 30-minute
session comes out as 1799.9999… and a truncating `CAST` reports **1799** — a second lost per
session and every total short.

⚠ **The session queries run in their own D1 batch.** A batch fails as a unit, so folding them
into `QUERIES` would blank the whole stats page in the window between deploying the Worker and
applying the migration — two manual steps that are not simultaneous. `sessionData()` swallows a
missing table and the page simply omits the section.

## 6. The stats page

`https://score.abhinav.dev/stats?days=30` runs the aggregate queries in `stats.ts` as one D1
batch — plus the session queries as a second, tolerant one (§5d) — and renders HTML
server-side. The **Session length** section shows sessions, how many reached five minutes,
median and longest, overlay hours, time on air per match, and the most recent sessions. It is protected by Cloudflare Access (JWT verified in
`access.ts` against the team JWKS) or, until Access is configured, by a `STATS_KEY` secret
passed as `?key=`.

🛑 **This repository is public. Never paste `STATS_KEY` into the repo, a doc, a commit message
or a session transcript.** It is a Worker secret and Cloudflare cannot read it back. The local
copy lives at `~/.config/cricket-scorecard-overlay/stats_key`, mode 600. Rotating it means
`npx wrangler secret put STATS_KEY` in `worker/` and updating that file.

## 7. Attribution is inferred, and it stays out of this repo

Usage can be attributed to people by joining club/team to a person, with **theme choice acting
as a fingerprint** — one operator uses `kkr` exclusively, another `topguns-light` and `neon`,
and everyone else leaves the default.

🛑 **The name mapping is not in this repo and must not be.** It lives only in
`~/code/cricket-stats` (`data/attribution/operators.json`), which has no remote. Real names of
league members stay out of a public repository.

## 8. Commands

```bash
cd worker
npm run dev              # local Worker with a local D1 (needs worker/.dev.vars with STATS_KEY)
npm run test:run         # Worker unit tests
npm run typecheck
npm run db:migrate       # apply D1 migrations remotely (wrangler login first)
npm run deploy
```

First-time setup of a fresh D1 and secrets:

```bash
npx wrangler login
npx wrangler d1 create overlay-analytics   # paste the id into wrangler.toml
npm run db:migrate
npx wrangler secret put STATS_KEY          # fallback until Access is configured
npx wrangler secret put VISITOR_SALT       # any long random string
npm run deploy
```
