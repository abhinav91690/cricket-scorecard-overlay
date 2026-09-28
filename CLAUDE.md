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
- ✅ **A pre-commit hook blocks a name reaching this repo.** Install once with
  `git config core.hooksPath .githooks`. It reads the names from gitignored local sources
  (`highlights/events.json`, `~/.config/cricket-scorecard-overlay/names.txt`) so no list is
  ever committed, and ⚠ it **fails OPEN** — with no source present it warns and allows the
  commit, so a green run is not a clean bill. Bypass with `--no-verify`.
- 🛑 **A league member's real name reached the test fixtures and is still on `main`.** It was
  the batting fixture across `highlights/test_*.py`, renamed to the placeholder `J. ROOT` on
  `fix/clip-alignment`, and it remains in **5 places on the TypeScript side**:
  `src/dataCode.vectors.json`, `src/dataCode.test.ts`, `src/dataQr.test.ts`,
  `src/tools/genDataVectors.ts`. Diff `highlights/test_reels.py` against `main` to see which
  name, rather than repeating it here. ⚠ The vector is generated and its bytes ARE the wire
  format, so renaming means regenerating with `genDataVectors.ts`, never editing the JSON —
  load `data-code.md` first. Use an obvious placeholder (`V. KOHLI`, `J. ROOT`) for any new
  fixture.
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
npm run sim:run -- --super-over [--seed 1]    # a tie decided by a super over
npm run record -- --match 4670,4671          # record live matches, anonymised, to sim/recordings/
npm run replay -- sim/matches/<file>.jsonl.gz --speed 60    # replay a real match and grade it

cd worker && npm run dev | test:run | typecheck | db:migrate | deploy
cd highlights && .venv/bin/python qrscan.py "<video>" -o events.json
# one argument per match; --contact-sheet writes a per-reel verification grid
cd highlights && .venv/bin/python reels.py --manifest matches/<slug>.json
git config core.hooksPath .githooks          # once: blocks a name reaching this public repo
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

⚠ **~87% of loads point at matches that already finished**, so a load count is opens, not use.
Session length exists now, from a 5-minute ping — but every figure is a floor, measured to the
last ping. → `analytics.md` §5

🛑 **A mocked D1 cannot see SQL semantics.** A one-line mutation making the session `ON CONFLICT`
overwrite `first_seen` — which zeroes every duration — passed the entire Worker suite.
`worker/src/sessions.test.ts` runs the real statements against real SQLite; keep it that way.
→ `analytics.md` §5d

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

🛑 **An Instagram long-lived token dies at 60 days and then cannot be refreshed at all** —
and *using* it does not extend it, only an explicit refresh does. An off-season gap longer
than 60 days silently kills the uploader. → `publishing.md` §8d

🛑 **Instagram has no private-first option.** The YouTube safety model — upload private, watch,
flip public — has no equivalent; a publish is live on success. Keep it manual-trigger only.
→ `publishing.md` §8e

⚠ **A landscape file uploaded as a "Short" produces no error** — it lands as an ordinary video
and the only way to notice is to look. → `publishing.md` §6

⚠ **`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` means `NODE_EXTRA_CA_CERTS` is not set in this shell**,
not that the network is broken. Homebrew is unusable through the same proxy. → `deployment.md` §3

⚠ **A phone cannot load `localhost` or anything behind a login.** Use a Netlify deploy preview
(`deploy-preview-<N>--score-overlay.netlify.app`) or `npm run dev -- --host 0.0.0.0`. →
`deployment.md` §2

🛑 **The clip lag is the SCORER's, not cricket's, and it is not constant — cut with
`reels.py --align`.** It spread 2-40 s inside one innings of `vs ATX Panthers`, so both the
default windows and a single measured `--lag-bat` put clips in the aftermath: batters
talking, crowd cheering, no shot. ⚠ And never "verify" a clip by checking the score moved
inside its own window — the window contains the state change by construction, so that check
cannot fail. → `highlights.md` §6b, §6c

🛑 **A delivery is the ONSET of a motion burst, never its strongest peak.** A boundary makes
two humps and the chase out-peaks the shot, so peak-picking put a four nine seconds late and
`MIN_GAP` suppression then deleted the real delivery from the candidate list — which is why
every tuning attempt reproduced the same stable wrong answer. → `highlights.md` §6c

🛑 **A delivery is preceded by a STILL field; the burst after one is not — that is the only
thing that separates them.** In innings 2 a wicket landed 4.5 s late on the aftermath, and
every global lever failed to move it: peak height, contrast, quietness, `STRENGTH`, and
`SMOOTH` from 0.5 to 0. ⚠ `SMOOTH` is the trap — that ball's true lag is 23 s against its
neighbour's 8 s, so a smoothness prior *prefers* the wrong answer, and removing it breaks
innings 1. → `highlights.md` §6d

⚠ **The camera is repositioned at the innings break, not at end swaps.** The bowling end
changes every 5 overs but the action does not move in frame — side-on, both ends share a
centre (centroid 47-55% in every block). Footage shot from behind the bowler's arm would not
have that property. → `highlights.md` §6d

🛑 **Keep clips tight and omit a ball you cannot place — widening was tried and is worse.**
It raised measured coverage from 5/8 to 8/8 hand-measured deliveries and was still reverted:
a 28 s clip showed the previous batter, a 52 s one a different bowler's over, and a 27 s one
put the shot at 0:22 of 0:27. A wrong-player clip is worse than an absent one, and coverage of
the right *instant* is not coverage of the right *ball*. `--widen` opts back in for review
passes only. → `highlights.md` §6e

⚠ **A coverage metric cannot see who is in the clip.** Every widening change looked like an
improvement by the numbers and was rejected on sight. Watch the reels before believing a
metric about them. → `highlights.md` §6e

🛑 **A scorer retraction emits the same event twice**, the duplicate carrying the re-entry's
timestamp — 256 s after the ball in the case that was caught, so its clip showed a different
player getting out. `dedupe_moments()` keeps the earliest. ⚠ The tell without a state trace:
a batter credited with three fours whose figures read `10 (5)`. → `highlights.md` §6f

⚠ **Bowler attribution is the scorer's data and is sometimes wrong** — one over named two
bowlers, and one bowler's four wickets span 28 minutes against figures of 2.1 overs. No clip
timing can fix that. → `highlights.md` §6f

⚠ **Every mis-aligned clip found by review had too SMALL a lag**, never too large — the
aligner had locked onto a burst after the ball. But small lags are often correct (6.1 s and
8.7 s balls verified good), so it is only a signal in combination. → `highlights.md` §6e

⚠ **An outlying scorer lag is the tell for a mis-aligned clip.** Both mis-alignments ever
confirmed by eye were the largest lag in their innings and nothing else was, so `shot_times()`
drops them — floored at 30 s, because a uniformly slow scorer is not a mis-alignment. It
catches the failure seen, not every one that exists; keep reviewing reel by reel.
→ `highlights.md` §6c

🛑 **Never cut a clip with raw ffmpeg — go through `cut.segments()`.** The `WINDOWS` are the
only thing that knows the scorer's graphic lags the ball (a six by ~5 s, a wicket by ~35 s), so
a hand-rolled `-ss` produces a clip of the batter waiting. → `highlights.md` §6

🛑 **Every field `sim/match.ts` does not set explicitly comes from a real, different match.** Its
scorebar spreads the match 2079 capture, so an unset field carries 2079's value into the simulated
game. It has happened twice — a live super over on every frame, then 2079's player of the match.
→ `docs/log.md` 2026-09-23

🛑 **Never commit a recording that has not been through `sim/anonymise.ts`, then `sim/reanonymise.ts`.**
Real frames carry player names and emails; the second pass catches a name first seen late, such as a
nickname in one dismissal string. `record.ts` does both; a hand-made file does neither. → `overlay.md` §13a

⚠ **Run `sim/` after any change to `views.ts`, `cards.ts`, `events.ts` or `app.ts`** — unit tests
did not catch the three bugs it found on its first runs. → `overlay.md` §13

🛑 **A replay must advance per poll, never against a clock, and a "flaky" replay is a real bug.**
Wall-clock sampling skipped 342 of 4674's 2,380 frames on an idle laptop and 491 under load, and a
skipped frame can carry the only state a card would have come from — so CI failed `19 queued for
20` on the runner while every local run passed. It looked like flakiness for two runs on `main`
before anyone measured it. → `overlay.md` §13a

🛑 **Decide which side is batting with `battingSecond()`, never `isSecondInningsStarted` directly.**
During a super over that flag may stay the main match's, and four modules reading it on their own
named the wrong side for the whole first super-over innings. Super-over overs are also a ball count —
use `teamOvers()`. → `overlay.md` §14b

🛑 **A live super over looks exactly like an innings break.** The scorebar swaps to the
super-over sides and totals, so `matchPhase()` must return `play` while `isSuperOver` is set, or
the main match's first innings goes on air mid-super-over. Match 2079 — every fixture's source —
is a super-over tie captured *after* it ended, so no fixture contains the broken window.
→ `overlay.md` §14b

🛑 **A CricClubs data view drops the live score fields**, so the overlay only *peeks* at one
between balls and `isFullFrame()` keeps a peek off the bar — and out of the `?data=1` code, which
would otherwise carry a CRC-valid frame of nonsense. → `overlay.md` §14

🛑 **Switching a view also switches CricClubs' own overlay for that match.** The club owner has
accepted this; do not widen the peeks without asking. → `cricclubs-api.md` §3

⚠ **`vite.config.ts` sets `base: './'` for relative overlay paths. Don't change it.**

🛑 **A test that cannot fail is not testing anything.** Four harness faults in `highlights/` each
made results look better or worse than reality, and every one was found by pushing until
something broke rather than by reading a green result. → `highlights.md` §7b
