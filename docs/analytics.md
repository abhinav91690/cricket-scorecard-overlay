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
heartbeat and no per-poll event**, which is why session length cannot be reported — see §5.

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

## 5. ⚠ Stream duration is not measurable, and that was a decision

The natural question — "how long did each stream last?" — cannot be answered from this data.
There is no heartbeat and no session ID, and the per-day visitor hash deliberately cannot be
joined across time. Answering it would need a periodic ping, which was cut on 3 September to
keep the collector off the poll path.

What *is* answerable is load counts, and ⚠ **about 87% of loads point at matches that had
already finished** — people leave a stale `matchId` in the browser-source field because editing
a long URL in a mobile app is awkward. Treat raw load counts accordingly.

## 6. The stats page

`https://score.abhinav.dev/stats?days=30` runs the aggregate queries in `stats.ts` as one D1
batch and renders HTML server-side. It is protected by Cloudflare Access (JWT verified in
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
