# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A client-side cricket scorecard overlay for OBS/vMix browser sources. Vite + TypeScript, no framework, no backend. It polls the public CricClubs `liveScoreOverlayData.do` endpoint every 5s and paints a fixed-position DOM. Everything is driven by URL query params (`matchId`, `clubId`, `theme`, `debug`, `mode`, `logo`); see README.md for the full table and `architecture.md` for the data-flow diagram.

## Commands

```bash
npm run dev            # Vite dev server on http://localhost:5173
npm run test           # vitest watch mode
npm run test:run       # single run (this is what build and CI use)
npm run test:coverage  # v8 coverage table (also available in worker/)
npx vitest run src/utils.test.ts            # one test file
npx vitest run -t "should return wicket"    # one test by name
npx tsc                # typecheck only (noEmit; strict + noUnusedLocals + noImplicitReturns)
npm run build          # tsc && test:run && vite build -> dist/ (dist is gitignored)
npm run preview        # serve the production build
```

```bash
cd worker                # Cloudflare Worker: analytics collector + /stats page
npm run dev              # local Worker with a local D1 (needs worker/.dev.vars with STATS_KEY for /stats)
npm run test:run         # Worker unit tests
npm run typecheck
npm run db:migrate       # apply D1 migrations remotely (wrangler login first)
npm run deploy
```

There is no linter. `npm run build` fails on type errors *and* test failures, so run it before opening a PR. CI (`.github/workflows/ci.yml`) runs the site build and the Worker typecheck/tests on every PR.

Deployment: Netlify builds `main` and serves it as `score.abhinav.dev`, proxied by Cloudflare. There is nothing to deploy for the site beyond merging. The Worker deploys via `.github/workflows/deploy-worker.yml` on pushes to `main` touching `worker/**` (skipped until a `CLOUDFLARE_API_TOKEN` secret exists) or manually with `npm run deploy` in `worker/`. `vite.config.ts` sets `base: './'`; don't change it.

## Architecture

Entry is `src/script.ts`, loaded directly from `index.html` as a module. It only imports the Montserrat font CSS and `css/instructions.css` (theme CSS is imported by `theme.ts`) and then calls into `src/app.ts`, which holds all orchestration and is where the tests point. `app.ts`:
1. Wires the Link Live Stream form once (`setupLinkStreamForm`).
2. Runs `pollLoop()`, which awaits `updateScore()` and then re-arms a `setTimeout(CONFIG.REFRESH_RATE)`. It is a timeout chain, not `setInterval`, so a slow CricClubs response can't overlap the next poll. A failed fetch keeps the last rendered frame once one has painted, and shows "Error" only before the first successful render.

`updateScore()` is the mode switch. In order: no `matchId`/`debug`/`mode=replay` → show `#instructions` and hide `.overlay`; `mode=replay` → cycle `replayData.ts`; `debug=1..5` → static state from `mockData.ts`; otherwise fetch live. Mock/replay data is cast `as unknown as CricketAPIData` because those fixtures don't fill every field of the (large) type in `types.ts`.

Rendering is in `src/ui.ts`. `updateScoreboard()` picks team 1 vs team 2 fields based on `values.isSecondInningsStarted === "true"` (API booleans are strings, `isMatchEnded` is `"1"`), then writes through `setText`/`setDisplay`/`setVisible` helpers that only touch the DOM when a value changed. `#secondInnings` is toggled with a `.is-visible` class (visibility+opacity) rather than `display` so the first-innings bar doesn't jump; keep that pattern if you add rows.

### `dom.ts` runs `getElementById` at import time

`DOM` is a plain object of element references resolved when the module first loads. Consequences:
- Anything importing `dom.ts` (`ui.ts`, `theme.ts`, `script.ts`) needs the real `index.html` structure present at import.
- In tests, `ui.test.ts` does `vi.mock('./dom', ...)` with a Proxy that maps property names to element IDs and looks them up lazily, after `beforeEach` has built the elements. Follow that pattern for any new test that touches `ui.ts`; don't import `dom.ts` directly in tests. `app.test.ts` instead mocks every collaborator (`./api`, `./ui`, `./theme`, `./analytics`, `./toast`, `./liveStream`) and asserts on calls.
- Modules with state expose `reset*ForTests()` hooks (`app.ts`, `ui.ts`, `analytics.ts`); call them in `beforeEach` rather than reaching into module internals.
- The Worker has its own `worker/vitest.config.ts` (node environment). Without it Vitest walks up and uses the site's jsdom config. The root config restricts `include` to `src/**` so the two suites never mix.
- Adding a new element means adding it to `index.html`, `dom.ts`, and the `idMap` in `ui.test.ts`.

### Theming

`applyTheme()` puts a `theme-<name>` class on `<body>` and consults the `THEMES` map in `theme.ts`, which tags each theme `standalone` or `broadcast`. `classic`, `modern` and `neon` are standalone: each `theme-*.css` is a complete, independent stylesheet. The 14 broadcast themes (IPL franchises + `tel`/`ted`/`tul`/`tud`) share `src/css/broadcast-base.css`, scoped under the `skin-broadcast` class that `applyTheme()` also adds; their `theme-*.css` files are only colour tokens (surfaces, lines, glows, text, `--ball-*`) plus the odd explicit override (RCB, CSK). Change layout in the base, never in a broadcast theme file. Unknown names fall back to `modern`.

Adding a broadcast theme: copy any broadcast `theme-*.css` and change the tokens, `import` it in `theme.ts`, add it to `THEMES` as `'broadcast'`, add a `theme-tag tag-<name>` span in `index.html` plus its `.tag-<name>` colour in `instructions.css`, and update the theme lists in README.md/architecture.md.

Ball indicator colors come from `getBallStyleClass()` in `utils.ts`, which maps outcome strings (`W`, `1wd`, `nb`, `4`, `.`) to classes (`wicket`, `wide`, `run-4`, `dot`, …) that each theme styles.

### Link Live Stream (`src/liveStream.ts`)

Attaches a YouTube URL to a CricClubs match via `updateLiveStreamURLFromCP.do`. CricClubs blocks this endpoint as a cross-origin subresource (CORP + WAF), so `fetch` (even `no-cors`), `<img>`, and `<iframe>` all fail. The working approach is a real top-level navigation: `window.open` in a small popup, synchronously inside the submit handler, closed after ~2s. Do not "simplify" this back to `fetch`; commits `25ceb63` and `f7459e3` document the failed attempts. There is also no client-side way to verify the update landed (the feed lags by up to a minute), so success copy says "submitted", not "linked".

### Analytics (`src/analytics.ts`, `worker/`)

`track()` POSTs to the same-origin `/api/collect`, handled by the Cloudflare Worker in `worker/` and stored in D1. Use `trackOnce()` for anything called from the poll loop; there is deliberately no heartbeat and no per-poll event. `isTrackingEnabled()` disables everything on localhost, `?debug=`, `?mode=replay`, `?nostats`, and Do Not Track, so nothing you do locally is recorded. Adding a new event means adding it to `EVENTS` in `worker/src/collect.ts` (the Worker rejects unknown names) and, if it needs new columns, a new file in `worker/migrations/`. The Worker's `wrangler.toml` routes claim only `/api/collect` and `/stats*`; everything else on the domain passes through to Netlify.

## Notes

- `CONFIG` (`src/config.ts`) holds the refresh rate, the default club ID (LPCL, `1089463`), the `?logo=` → sponsor image map (images imported from `src/assets/images/` so Vite bundles them), and the analytics endpoint.
- Team logo URLs from the API may be relative; `updateTeamLogos()` prefixes `https://cricclubs.com` and caches by URL so polling doesn't refetch images.
- `feature-ideas.md` lists unused API fields (run rates, partnership, last wicket, MOM, etc.) that are already typed in `types.ts` if you're asked to add overlay features.
- Branch naming in history is `feature/…`, `fix/…`, `docs/…`; commit subjects use conventional prefixes (`feat:`, `fix:`, `docs:`, `ci:`, `test:`).
