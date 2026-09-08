# Cricket Scorecard Overlay

A professional, lightweight, and responsive cricket scorecard overlay designed for live streaming (OBS, vMix, etc.). It fetches real-time match data from the **CricClubs** API or runs in debug mode with mock data.

## Features
- **Real-Time Updates**: Polls the API automatically for live scores.
- **17 Themes**: One clean broadcast layout with a colour palette for every IPL franchise, three core palettes (classic, modern, neon) and the Topguns set. See [Available Themes](#available-themes) below.
- **Home page with a link builder**: Visit the site with no parameters to build your overlay URL, preview any theme with sample data, and link a YouTube stream to a match.
- **Link Live Stream**: A home-screen utility to attach a YouTube live stream link to a CricClubs match without leaving the overlay.
- **Self-Hosted Fonts**: Uses **Montserrat** (bundled) for consistent rendering across all devices without external dependencies.
- **Performance Optimized**: Zero layout shifts (CLS), minimal network footprint, and bundled CSS.
- **Developer Experience**: Built with **Vite** and **TypeScript**.
- **Usage Analytics**: A tiny first-party collector (Cloudflare Worker + D1) records which matches, themes, and streaming apps use the overlay. No cookies, no third parties; see [Usage analytics](#usage-analytics).

---

## Quick Start

### 1. Install & Run Locally
```bash
# Install dependencies
npm install

# Start development server
npm run dev
```
The server usually starts at `http://localhost:5173`.

Visiting the app with no `matchId` shows the home page: a URL builder that writes the overlay link for you, one-click theme previews, the Link Live Stream form (see below) and a reference table of every parameter.

### 2. Add to OBS
1.  Add a **Browser Source** in OBS.
2.  Set the URL to your local server (or deployed GitHub Pages URL).
3.  Set Width: `1920`, Height: `1080` (or your canvas size).
4.  Append the necessary query parameters (see below).

---

## Configuration (URL Parameters)

Control the behavior and look of the overlay using URL parameters:

| Parameter | Required? | Description | Example |
| :--- | :--- | :--- | :--- |
| `matchId` | **Yes** | The unique Match ID from CricClubs. | `?matchId=1939` |
| `clubId` | No | The Club ID (Default: `1089463`, LPCL). | `?clubId=12345` |
| `theme` | No | One of the themes listed below (default: `modern-light`; `modern` still works as an alias). | `?theme=kkr` |
| `debug` | No | Use mock data (1-5) instead of live API. | `?debug=1` |
| `mode` | No | Special modes like `replay`. | `?mode=replay` |
| `quiet` | No | Turns off the event cards and shows only the bar. | `?quiet` |
| `logo` | No | Displays specific sponsor logos. | `?logo=1` |

### Event cards
The bar stays constant; moments earn a card that slides in over the batter and bowler slots, holds, and leaves. Cards are derived by diffing one poll against the previous one, so nothing extra is requested:

| Card | Trigger | Holds |
| :--- | :--- | :--- |
| Wicket | batting side's wicket count rises | 8s |
| Fifty / Hundred | a batter crosses 50 or 100 | 8s |
| Four / Six | the newest ball is a boundary | 2s |
| 50 / 100 partnership | the current stand crosses 50 or 100 | 6s |

Cards queue and play one at a time; a wicket suppresses the boundary flash on the same ball, and the wicket card shows the fall of wicket ("3rd wkt · 84/3"). **Two rules always hold**: every card is timed, and any change to the score dismisses whatever is showing. `?quiet` disables them. In debug mode, `&card=wicket` (or `milestone`, `partnership`, `boundary`) holds a sample card so you can position it in OBS.

### Panels between the action
While nothing can happen the overlay fills the gap by itself, using richer CricClubs data it fetches by switching the match's overlay view for a single poll (see [docs/cricclubs-api.md](docs/cricclubs-api.md)):

| Match state | Panel above the bar |
| :--- | :--- |
| Before the first ball | Line-up card: both crests, one column of headshots per side, then the toss as the headline with series and ground |
| Innings break | First-innings summary: top batters and bowlers, extras, fall of wickets, target |
| Match over | Match summary: the result, then both innings side by side |

Panels rotate on timers and disappear the moment a ball is bowled. The overlay never leaves the live scorebar view while play is possible; it peeks at the squads before the match, team 1's cards at the break and team 2's at the end, one poll each. `&panel=lineup` (or `innings-summary`, `match-summary`) with `?debug=` holds a sample.

### Debug Modes
Test layouts without a live match:
- `?debug=1`: 1st Innings (Standard)
- `?debug=2`: 2nd Innings (Chasing)
- `?debug=3`: Match Ended
- `?debug=4`: Pre-match / Toss
- `?debug=5`: No Team Logos

### Available Themes
Every theme shares the same layout (`src/css/overlay-base.css`); a theme is a palette of colour tokens.
- **Core**: `classic` (cream/navy), `modern-light` (default), `modern-dark`, `neon`
- **IPL Franchises**: `kkr`, `rcb`, `mi`, `csk`, `dc`, `rr`, `srh`, `pbks`, `gt`, `lsg`
- **Topguns**: `topguns-light`, `topguns-dark` (the old `tel`/`ted`/`tul`/`tud` names still work as aliases)

---

## Link Live Stream

The home page (shown when no `matchId` is provided) includes a form to attach a YouTube live stream link to a CricClubs match: enter the Club ID (prefilled to the default), Match ID, and the YouTube URL, then submit. The button shows a busy state while the request is sent; success means CricClubs received it, and the public feed can take up to a minute to reflect it.

---

## Usage analytics

The production site reports a few anonymous events to a first-party endpoint (`/api/collect`, a Cloudflare Worker in [`worker/`](worker/)) so we can see which matches, clubs, themes and streaming apps actually use the overlay:

| Event | When | What is recorded |
| :--- | :--- | :--- |
| `overlay_start` | Once per page load with a real `matchId` | club ID, match ID, theme, logo, client (OBS / vMix / Streamlabs / Prism / browser) and version, OS, screen size |
| `home_view` | The home screen is shown | client, OS, screen size |
| `link_stream_submit` | The Link Live Stream form is submitted | club ID, match ID, YouTube video ID, outcome |

Cloudflare adds country, city and a **daily-rotating** salted hash used only to count distinct viewers within a day. There are no cookies, no persistent identifiers, and nothing is sent from `localhost`, `?debug=` mock modes or `?mode=replay`. Add **`?nostats=1`** to any URL to opt out; the browser's Do Not Track setting is honoured too.

Aggregates are served at `https://score.abhinav.dev/stats` (private, behind Cloudflare Access).

---

## Deployment

**Site**: [Netlify](https://www.netlify.com/) builds `main` (`npm run build`, publish `dist/`) and serves it as **https://score.abhinav.dev**, proxied through Cloudflare. Nothing to do beyond merging.

**Analytics Worker**: lives in [`worker/`](worker/) and is deployed with Wrangler.

```bash
cd worker
npm install
npx wrangler login                     # once
npx wrangler d1 create overlay-analytics   # once; paste the id into wrangler.toml
npm run db:migrate                     # apply migrations to the remote D1 database
npx wrangler secret put STATS_KEY      # fallback key for /stats until Access is configured
npx wrangler secret put VISITOR_SALT   # any long random string
npm run deploy
```

Pushes to `main` that touch `worker/**` also deploy automatically via `.github/workflows/deploy-worker.yml` once a `CLOUDFLARE_API_TOKEN` repository secret exists.

To lock `/stats` behind your login, create a Cloudflare Access self-hosted application for `score.abhinav.dev/stats*`, then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.toml` and redeploy.

---

## Development commands

```bash
# Run unit tests (watch mode)
npm run test

# Run unit tests once (used in the build)
npm run test:run

# Build for production (outputs to /dist)
npm run build

# Preview the production build locally
npm run preview

# Simulated match (see sim/): fake CricClubs + headless Chrome through a whole game, graded
npm run sim:run

# Analytics Worker (run inside worker/)
npm run dev              # local Worker + local D1 on http://localhost:8787
npm run test:run         # Worker unit tests
npm run typecheck
```

See [architecture.md](architecture.md) for a deeper look at the project structure and data flow, and [docs/cricclubs-api.md](docs/cricclubs-api.md) for what we know about the CricClubs endpoints.
