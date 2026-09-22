# CLAUDE.md — Cricket Scorecard Overlay

Context for every session in this folder. **Read before acting.**

This file is deliberately short: it holds the **ground rules**, an **address index** and
**one-line tripwires**. The domain documents live in **`docs/`** as an **Open Knowledge Format
v0.2 bundle** (`okf-base.yaml` at the root, index at `docs/index.md`) — validate with
`okflint validate --manifest okf-base.yaml`. The reasoning, the as-built detail and the full
traps live in the concepts. **Load the relevant concept before working in that area** — the
tripwires here tell you the mistake exists, not how to fix it.

## What this is

A client-side cricket scorecard overlay for OBS/vMix browser sources. Vite + TypeScript, no
framework, no backend. It polls the public CricClubs `liveScoreOverlayData.do` endpoint every 5 s
and paints a fixed-position DOM, driven entirely by URL query params (`matchId`, `clubId`,
`theme`, `debug`, `mode`, `logo`, `data`). `README.md` is the user-facing guide;
`highlights/` turns a recording into reels.

## Ground rules

- 🛑 **This repository is public.** Never commit a secret, a key, or the real name of a league
  member. `STATS_KEY` lives only as a Worker secret and at
  `~/.config/cricket-scorecard-overlay/stats_key`; the YouTube OAuth client and token live in
  the **macOS Keychain** (`cricket-overlay-youtube-client` / `-token`); attribution names live
  only in `~/code/cricket-stats`, which has no remote.
- ⚠ **Never write a secret to the Keychain with `security add-generic-password -w`** — the
  prompt truncates at 128 chars silently, and passing the value inline puts it in argv. →
  `publishing.md` §4a
- 🛑 **Player rows in the CricClubs card views carry email addresses.** They must never be
  rendered or stored. `stripPii()` runs first in `renderFrame()`, and the fixtures in
  `mockData.ts` were captured live with emails removed.
- ⚠ **`npm run build` is the gate** — it fails on type errors *and* test failures. There is no
  linter. Run it before opening a PR.
- **Ask before anything outward-facing**: deploying the Worker, merging to `main`, adding a repo
  secret, or pushing to a branch someone else has open.
- Branches are `feature/…`, `fix/…`, `docs/…`, `design/…`, `test/…`; commit subjects use
  conventional prefixes (`feat:`, `fix:`, `docs:`, `ci:`, `test:`, `perf:`, `build:`).
- Recordings and reels are **gitignored and must stay that way**. 🛑 That rule is not yet on
  `main` — it must ride along with whichever PR lands first.

## Commands

```bash
npm run dev            # Vite dev server on http://localhost:5173
npm run test           # vitest watch
npm run test:run       # single run — what build and CI use
npm run build          # tsc && test:run && vite build -> dist/
npx tsc                # typecheck only
npx vitest run src/utils.test.ts            # one file
npx vitest run -t "should return wicket"    # one test

npm run sim            # fake CricClubs serving a simulated match (view switching included)
npm run sim:run        # headless end-to-end run of a whole match; report in sim/out/

cd worker && npm run dev | test:run | typecheck | db:migrate | deploy
cd highlights && .venv/bin/python qrscan.py "<video>" -o events.json
```

## Where things live

| File | Load it before… |
|---|---|
| **`docs/overlay.md`** | anything under `src/` — poll loop, rendering, themes, event cards, Link Live Stream |
| **`docs/data-code.md`** | `src/dataCode.ts`, `src/dataQr.ts` or `highlights/payload.py`. 🛑 **A wire format with a cross-language contract** |
| **`docs/highlights.md`** | anything under `highlights/` — the two scanners, event rules, clip windows |
| **`docs/publishing.md`** | uploading to YouTube — setup, the 7-day OAuth trap, Shorts validation |
| **`docs/analytics.md`** | anything under `worker/` or `src/analytics.ts` |
| **`docs/deployment.md`** | deploying, or debugging a TLS failure on this machine |
| **`docs/feature-ideas.md`** | designing a new overlay feature — the data may already be arriving |
| **`docs/cricclubs-api.md`** | anything that fetches — endpoints, the `view` mechanism, per-view payload shapes |
| **`docs/log.md`** | what changed and when |

## Tripwires

Each says only that a mistake exists. The fix is in the concept.

🛑 **The event-card accent palette is a contract, not decoration.** Five fixed colours, never
theme-overridden; `highlights/` identifies events from that 5 px stripe alone. Changing one
silently breaks detection on every future match. → `overlay.md` §6a

🛑 **`dom.ts` runs `getElementById` at import time.** Never import it directly in a test; a new
element must be added in three places. → `overlay.md` §4

🛑 **Link Live Stream must stay a `window.open` popup.** `fetch`, `<img>` and `<iframe>` are all
blocked by CORP + WAF; commits `25ceb63` and `f7459e3` document the failed attempts. →
`overlay.md` §8

⚠ **API booleans are strings** — `isSecondInningsStarted` is `"true"`, `isMatchEnded` is `"1"`.
→ `overlay.md` §3

⚠ **A boundary off a no-ball arrives fused with the penalty**: a six reads `7nb`, not `6`. It was
invisible to both the cards and the highlights until `c455921`. → `overlay.md` §6b

🛑 **Never decode the data code with OpenCV.** `cv2.QRCodeDetector` returns a str and mangles
arbitrary bytes — 0 of 60 random payloads recovered from *perfect* images, while reporting
success every time. Use zxing-cpp. → `data-code.md` §6

⚠ **Never generate a test QR with the Python `qrcode` library** — it inflated 42 random bytes to
a v14 code, 73 modules instead of 29. Use the npm encoder the overlay ships. → `data-code.md` §6

🛑 **A match streamed without `?data=1` can never have per-player reels.** No code in the
pixels means no names, and attribution cannot be recovered afterwards — one query parameter
loses a whole match's reels. → `highlights.md` §14

🛑 **The `?data=1` geometry is a measured floor, not a preference.** 2 px modules and a 2-module
quiet zone; 1 px cannot work and no amount of ECC changes that. Do not shave it without
re-measuring. → `data-code.md` §1

🛑 **The Worker deploy is manual on purpose.** `deploy-worker.yml` skips itself until a
`CLOUDFLARE_API_TOKEN` secret exists, and not adding it is a decision. Don't add it without
asking. → `analytics.md` §4

⚠ **Stream duration is not measurable**, and ~87% of loads point at matches that already
finished. Treat raw load counts accordingly. → `analytics.md` §5

🛑 **Never record an untested platform restriction as a tripwire.** This slot used to say an
unverified API project cannot publish publicly to YouTube. Google documents that, but it was
never tested here — and when it finally was, the upload landed public. The false certainty cost
a Make.com detour and an R2 plan, to route around a wall nobody had pushed on. →
`publishing.md` §0

⚠ **httplib2 ignores the system trust store, `SSL_CERT_FILE` *and* `REQUESTS_CA_BUNDLE`**, so
every Google API call fails on the corporate proxy while `requests` in the same process
succeeds. Hand it `ca_certs` explicitly. → `publishing.md` §4b

⚠ **"Testing" mode also blocks non-tester accounts outright** with a 403, which looks nothing
like the clickable unverified-app warning. → `publishing.md` §3a

🛑 **A Google OAuth consent screen left in "Testing" expires refresh tokens after exactly 7
days.** An unattended uploader works for a week and then silently stops. Set it to "In
Production". → `publishing.md` §3

⚠ **A landscape file uploaded as a "Short" produces no error** — it lands as an ordinary video
and the only way to notice is to look. → `publishing.md` §6

⚠ **`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` means `NODE_EXTRA_CA_CERTS` is not set in this shell**,
not that the network is broken. Homebrew is unusable through the same proxy. → `deployment.md` §3

⚠ **A phone cannot load `localhost` or anything behind a login.** Use a Netlify deploy preview
(`deploy-preview-<N>--score-overlay.netlify.app`) or `npm run dev -- --host 0.0.0.0`. →
`deployment.md` §2

⚠ **Run `sim/` after any change to `views.ts`, `cards.ts`, `events.ts` or `app.ts`** — unit tests
did not catch the three bugs it found on its first runs. → `overlay.md` §13

🛑 **A CricClubs data view drops the live score fields**, so the overlay only *peeks* at one
between balls and `isFullFrame()` keeps a peek off the bar — and out of the `?data=1` code, which
would otherwise carry a CRC-valid frame of nonsense. → `overlay.md` §14

🛑 **Switching a view also switches CricClubs' own overlay for that match.** The club owner has
accepted this; do not widen the peeks without asking. → `cricclubs-api.md` §3

⚠ **`vite.config.ts` sets `base: './'` for relative overlay paths. Don't change it.**

🛑 **A test that cannot fail is not testing anything.** Four harness faults in `highlights/` each
made results look better or worse than reality, and every one was found by pushing until
something broke rather than by reading a green result. → `highlights.md` §7b
