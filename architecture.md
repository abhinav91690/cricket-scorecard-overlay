# System Architecture - Cricket Scorecard Overlay

The Cricket Scorecard Overlay is a lightweight, client-side web application designed to display real-time cricket scores during live broadcasts. It leverages the CricClubs API to fetch data, provides a customizable UI through a modular CSS theming system, and includes a small utility for linking a YouTube live stream to a CricClubs match. It's built with Vite + TypeScript and tested with Vitest.

## Project Structure

```text
cricket-scorecard-overlay/
├── src/
│   ├── assets/images/  # Sponsor logos, imported by config.ts so Vite bundles them
│   ├── script.ts       # Entry point: polling loop, mode/debug/replay branching, form wiring
│   ├── config.ts       # CONFIG constant (refresh rate, default club ID, logo map)
│   ├── types.ts        # CricketAPIData/CricketAPIValues interfaces modeling the CricClubs response
│   ├── dom.ts          # DOM element lookup map
│   ├── api.ts          # fetchScoreData() - fetches and parses the live score JSON
│   ├── ui.ts           # updateScoreboard()/updateBallByBall()/updateTeamLogos() - DOM updates
│   ├── theme.ts        # applyTheme()/updateLogo() - theme class + sponsor logo switching
│   ├── liveStream.ts   # linkLiveStream() - the Link Live Stream popup workflow
│   ├── toast.ts        # showToast() - transient success/error notifications
│   ├── utils.ts        # getQueryParams(), loadImage(), getBallStyleClass()
│   ├── mockData.ts     # Static match states for ?debug=1-5
│   ├── replayData.ts   # Sequence of match states for ?mode=replay
│   ├── *.test.ts       # Vitest unit tests (ui, utils, liveStream)
│   └── css/
│       ├── instructions.css   # Home screen (setup instructions + Link Live Stream form) styling
│       └── theme-*.css        # One file per theme (see Theming System below)
├── index.html          # Application entry point & DOM structure
├── architecture.md     # This document
└── README.md           # Quick start and configuration guide
```

## Core Components

### 1. Data Polling Engine
Located in `src/script.ts`, `updateScore()` runs once on load and then is re-scheduled with `setTimeout` *after* each run completes (`pollLoop()`), so a slow response can never overlap the next poll. On a failed fetch it keeps the last good frame on screen once at least one has rendered; before that it shows "Error" so a wrong `matchId` is visible during setup.
- **Refresh Rate**: `CONFIG.REFRESH_RATE`, default 5000ms.
- **Fetch Logic**: `fetchScoreData()` (`src/api.ts`) calls the CricClubs `liveScoreOverlayData.do` endpoint and parses the JSON response. This endpoint is public/CORS-open, so it works directly from any origin without credentials.
- **Mode branching**: `updateScore()` decides between showing the home screen (no `matchId`/`debug`/`mode=replay`), mock data (`?debug=1-5`, from `mockData.ts`), replay data (`?mode=replay`, cycling through `replayData.ts`), or a live fetch.

### 2. State Management & DOM Updates
- **DOM Mapping**: The `DOM` constant in `src/dom.ts` maps HTML IDs to typed element references for efficient, repeated updates.
- **Normalization**: `updateScoreboard()` (`src/ui.ts`) processes raw API data and updates text content, visibility, and styles, only touching the DOM when a value actually changes (via `setText`/`setDisplay`/`setVisible` helpers) to avoid layout thrash.
- **Ball-by-Ball Tracking**: `updateBallByBall()` manages the history of the current over, injecting a styled indicator per delivery.
- **Team Logos**: `updateTeamLogos()` caches loaded logo images and only re-fetches when the URL changes.

### 3. Theming System
- **Dynamic CSS**: Themes are applied by toggling a `theme-<name>` class on `<body>` via `applyTheme()` (`src/theme.ts`).
- **CSS Variables**: Each `src/css/theme-*.css` file defines colors/shadows/radii as CSS custom properties scoped to its theme class, so adding a theme means adding one CSS file plus one entry in the `AVAILABLE_THEMES` list.
- **Available themes** (17 total): `classic`, `modern`, `neon` (defaults); `kkr`, `rcb`, `mi`, `csk`, `dc`, `rr`, `srh`, `pbks`, `gt`, `lsg` (IPL franchises); `tel`, `ted`, `tul`, `tud` (custom).
- **Outcome Styling**: `getBallStyleClass()` (`src/utils.ts`) maps cricket outcomes (Wicket, Wide, 4, 6, etc.) to CSS classes for color-coded ball indicators.

### 4. Home Screen & Link Live Stream
When no `matchId`/`debug`/`mode=replay` is present, `updateScore()` shows `#instructions` instead of the overlay. That screen has two cards:
- Setup instructions (required/optional params, example URL, theme list).
- The **Link Live Stream** form (Club ID, Match ID, YouTube URL), wired up once at startup by `setupLinkStreamForm()` in `src/script.ts`.

`linkLiveStream()` (`src/liveStream.ts`) attaches a YouTube URL to a CricClubs match via `updateLiveStreamURLFromCP.do`. That endpoint blocks cross-origin subresource requests outright — `fetch` (including `mode: 'no-cors'`) and `<img>`/`<iframe>` embeds all get rejected by a `Cross-Origin-Resource-Policy` check plus WAF heuristics that flag embedded/automated-looking requests. A genuine top-level navigation isn't a subresource load, so it isn't subject to either check. The workaround: open the URL in a small popup synchronously from the click handler (required for the browser to allow it), then close the popup shortly after. This only confirms the request was *sent*; CricClubs' own feed can take up to a minute to reflect the change, so there's no fast, reliable way to verify it client-side, and the toast/copy is worded accordingly ("submitted", not "linked").

## Data Flow

```mermaid
graph TD
    A[CricClubs liveScoreOverlayData.do] -->|JSON Data| B(script.ts: updateScore)
    B -->|Fetch/Mock/Replay| C{Data Source}
    C -->|API Response| D[updateScoreboard]
    C -->|Mock/Replay| D
    D --> E[DOM Updates]
    E --> F[Scorecard Pill]
    E --> G[Player Stats]
    E --> H[Ball-by-Ball Container]
    F & G & H -->|Styled By| I(theme-*.css, selected via theme.ts)

    J[Link Live Stream form] -->|popup navigation| K[CricClubs updateLiveStreamURLFromCP.do]
    J -->|success/error| L[toast.ts]
```

## Testing & Debugging Modes

- **Unit Tests**: Vitest + jsdom, covering `ui.ts` (scoreboard rendering, instructions visibility), `utils.ts` (query param parsing, ball styling), and `liveStream.ts` (popup navigation, error paths). Run via `npm run test` (watch) or `npm run test:run` (single run, used in `npm run build`).
- **Debug Mode**: `?debug=1-5` renders static states from `mockData.ts` (1st/2nd innings, match ended, toss, no team logos).
- **Replay Mode**: `?mode=replay` cycles through the states in `replayData.ts` to demonstrate transitions and animations.
- **Theme Previews**: `?theme=<name>` switches between any of the 17 themes.

## External Dependencies
- **`@fontsource/montserrat`**: Self-hosted Montserrat font, bundled at build time (no external font requests at runtime).
- **CricClubs**: `liveScoreOverlayData.do` (public, CORS-open, read) for score polling; `updateLiveStreamURLFromCP.do` (write, cross-origin-restricted) for the Link Live Stream feature.
