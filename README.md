# Cricket Scorecard Overlay

A lightweight cricket scorecard overlay for live streaming (OBS, vMix, Streamlabs, IRL Pro). It
polls the **CricClubs** API for live scores, or runs on mock data for setup and testing.

**Live at [score.abhinav.dev](https://score.abhinav.dev)** — open it with no parameters to build
your overlay URL, preview any theme, and link a YouTube stream to a match.

> **Looking for *why* something works the way it does?** This README is a usage guide. The
> reasoning, the trade-offs and the traps live in the knowledge bundle at
> **[`docs/`](docs/index.md)**.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

### Add it to your streaming app

1. Add a **Browser Source**.
2. Set the URL to `https://score.abhinav.dev/?matchId=<your match id>`.
3. Set the size to **1920 × 1080**. The page background is transparent.

Visiting the site with no `matchId` shows the home page: a URL builder, one-click theme
previews, the Link Live Stream form, and a reference table of every parameter.

---

## URL parameters

| Parameter | Required? | Description | Example |
| :--- | :--- | :--- | :--- |
| `matchId` | **Yes** | The match ID from CricClubs. | `?matchId=1939` |
| `clubId` | No | The club ID (default `1089463`, LPCL). | `?clubId=12345` |
| `theme` | No | Any theme below (default `modern-light`). | `?theme=kkr` |
| `debug` | No | Mock data, `1`–`5`, instead of the live API. | `?debug=1` |
| `mode` | No | `replay` cycles through sample states. | `?mode=replay` |
| `quiet` | No | Turns off the event cards; bar only. | `?quiet` |
| `logo` | No | Shows a sponsor logo. | `?logo=1` |
| `data` | No | Draws a small machine-readable code for highlights. Off by default. | `?data=1` |
| `nostats` | No | Opts out of anonymous usage analytics. | `?nostats=1` |

In debug mode, `&card=wicket` (or `milestone`, `partnership`, `four`, `six`) holds a sample
event card so you can position it.

### Debug modes

| | |
|---|---|
| `?debug=1` | first innings |
| `?debug=2` | second innings, chasing |
| `?debug=3` | match ended |
| `?debug=4` | pre-match / toss |
| `?debug=5` | no team logos |

### Themes

Every theme shares one layout; a theme is a palette of colour tokens.

- **Core** — `classic`, `modern-light` (default), `modern-dark`, `neon`
- **IPL franchises** — `kkr`, `rcb`, `mi`, `csk`, `dc`, `rr`, `srh`, `pbks`, `gt`, `lsg`
- **Topguns** — `topguns-light`, `topguns-dark`

The old `modern`, `tel`, `ted`, `tul` and `tud` names still work as aliases.

### Event cards

Moments earn a card that slides in over the batter and bowler slots, holds, and leaves. They are
derived by diffing one poll against the previous one, so nothing extra is requested.

| Card | Trigger | Holds |
| :--- | :--- | :--- |
| Wicket | the batting side's wicket count rises | 8 s |
| Fifty / Hundred | a batter crosses 50 or 100 | 8 s |
| Four / Six | the newest ball is a boundary off the bat | 2 s |
| 50 / 100 partnership | the current stand crosses 50 or 100 | 6 s |

Cards queue and play one at a time; a wicket suppresses the boundary flash on the same ball, and the wicket card shows the fall of wicket ("3rd wkt · 84/3"). **Two rules always hold**: every card is timed, and any change to the score dismisses whatever is showing. `?quiet` disables them. In debug mode, `&card=wicket` (or `milestone`, `partnership`, `boundary`) holds a sample card so you can position it in OBS.

### Panels between the action
While nothing can happen the overlay fills the gap by itself, using richer CricClubs data it fetches by switching the match's overlay view for a single poll (see [docs/cricclubs-api.md](docs/cricclubs-api.md)):

| Match state | Panel above the bar |
| :--- | :--- |
| Before the first ball | Line-up card: series, ground and overs on top, both crests, the toss as a callout ("Topguns United elected to bat"), then each XI in two columns of headshots with a Batting / Fielding tag worked out from the toss |
| Innings break | First-innings summary: the batting side with its total large on the right, tiles for run rate, boundaries, extras and the target, then top scorers and best bowling with headshots, fall of wickets beneath |
| Match over | Result card: the result as the headline, then a card per side with its score, top two batters and best bowler (the winner's card accented), then a strip of the match's top performers — led by CricClubs' player of the match when one is named |

Panels rotate on timers and disappear the moment a ball is bowled. The overlay never leaves the live scorebar view while play is possible; it peeks at the squads before the match, team 1's cards at the break and team 2's at the end, one poll each. `&panel=lineup` (or `innings-summary`, `match-summary`) with `?debug=` holds a sample.

### Machine-readable data code

`?data=1` draws a 66 × 66 px code in the top-left corner carrying the current bar state, so a
recording can be turned into highlights without guessing anything from the picture. It is 0.21%
of the frame and meant to be cropped away. Leave it off unless you are making highlights — see
[`docs/data-code.md`](docs/data-code.md).

---

## Link Live Stream

The home page has a form to attach a YouTube live stream link to a CricClubs match: club ID
(prefilled), match ID, and the YouTube URL.

It opens a small CricClubs window briefly, so **allow pop-ups for this site**. Success means
CricClubs received the request; the public feed can take up to a minute to show it.

---

## Usage analytics

The production site reports a few anonymous events to a first-party endpoint (`/api/collect`, a
Cloudflare Worker in [`worker/`](worker/)) so we can see which matches, themes and streaming apps
use the overlay: `overlay_start`, `home_view` and `link_stream_submit`.

No cookies, no third parties, no persistent identifiers. Nothing is sent from `localhost`,
`?debug=` modes or `?mode=replay`. Add **`?nostats=1`** to opt out; Do Not Track is honoured too.

Details, including what is stored and what deliberately is not, are in
[`docs/analytics.md`](docs/analytics.md).

---

## Highlights

`highlights/` turns a match recording into reels locally — no cloud, no upload, no API keys. It
reads the `?data=1` code out of the recording, or falls back to identifying event cards by
colour for older files.

```bash
cd highlights
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python qrscan.py "/path/match.mp4" -o events.json
.venv/bin/python cut.py   "/path/match.mp4" events.json -o reel.mp4
```

See [`docs/highlights.md`](docs/highlights.md).

---

## Development

```bash
npm run test           # watch mode
npm run test:run       # single run (used by the build)
npm run build          # tsc && test:run && vite build -> dist/
npm run preview        # serve the production build
npx tsc                # typecheck only

cd worker              # the analytics Worker
npm run dev            # local Worker + local D1
npm run test:run
npm run typecheck
```

```bash
# Play a whole simulated match through the real overlay, headless, and grade it
npm run sim:run
```

`npm run build` fails on type errors **and** test failures, so run it before opening a PR.

**Deployment**: Netlify builds `main` and serves it as `score.abhinav.dev`, proxied by
Cloudflare — nothing to do beyond merging. The analytics Worker is deployed manually and on
purpose; see [`docs/deployment.md`](docs/deployment.md) and
[`docs/analytics.md`](docs/analytics.md).

---

## Documentation

| | |
|---|---|
| [`docs/index.md`](docs/index.md) | the knowledge bundle — start here for *why* |
| [`CLAUDE.md`](CLAUDE.md) | ground rules and tripwires for agents working in this repo |

The bundle is an [Open Knowledge Format](docs/index.md) v0.2 base; validate it with
`okflint validate --manifest okf-base.yaml`.
