# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A client-side cricket scorecard overlay for OBS/vMix browser sources. Vite + TypeScript, no framework, no backend. It polls the public CricClubs `liveScoreOverlayData.do` endpoint every 5s and paints a fixed-position DOM. Everything is driven by URL query params (`matchId`, `clubId`, `theme`, `debug`, `mode`, `logo`); see README.md for the full table and `architecture.md` for the data-flow diagram.

## Commands

```bash
npm run dev            # Vite dev server on http://localhost:5173
npm run test           # vitest watch mode
npm run test:run       # single run (this is what build and CI use)
npx vitest run src/utils.test.ts            # one test file
npx vitest run -t "should return wicket"    # one test by name
npx tsc                # typecheck only (noEmit; strict + noUnusedLocals + noImplicitReturns)
npm run build          # tsc && test:run && vite build -> dist/ (dist is gitignored)
npm run preview        # serve the production build
```

There is no linter. `npm run build` fails on type errors *and* test failures, so run it before opening a PR.

Deployment is automatic: pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages. `vite.config.ts` sets `base: './'` so the built assets resolve under the Pages subpath; don't change it.

## Architecture

Entry is `src/script.ts`, loaded directly from `index.html` as a module. It:
1. Imports the Montserrat font CSS and `css/instructions.css` (theme CSS is imported by `theme.ts`).
2. Wires the Link Live Stream form once (`setupLinkStreamForm`).
3. Runs `updateScore()` immediately and then on `setInterval(CONFIG.REFRESH_RATE)`.

`updateScore()` is the mode switch. In order: no `matchId`/`debug`/`mode=replay` → show `#instructions` and hide `.overlay`; `mode=replay` → cycle `replayData.ts`; `debug=1..5` → static state from `mockData.ts`; otherwise fetch live. Mock/replay data is cast `as unknown as CricketAPIData` because those fixtures don't fill every field of the (large) type in `types.ts`.

Rendering is in `src/ui.ts`. `updateScoreboard()` picks team 1 vs team 2 fields based on `values.isSecondInningsStarted === "true"` (API booleans are strings, `isMatchEnded` is `"1"`), then writes through `setText`/`setDisplay`/`setVisible` helpers that only touch the DOM when a value changed. `#secondInnings` is toggled with a `.is-visible` class (visibility+opacity) rather than `display` so the first-innings bar doesn't jump; keep that pattern if you add rows.

### `dom.ts` runs `getElementById` at import time

`DOM` is a plain object of element references resolved when the module first loads. Consequences:
- Anything importing `dom.ts` (`ui.ts`, `theme.ts`, `script.ts`) needs the real `index.html` structure present at import.
- In tests, `ui.test.ts` does `vi.mock('./dom', ...)` with a Proxy that maps property names to element IDs and looks them up lazily, after `beforeEach` has built the elements. Follow that pattern for any new test that touches `ui.ts`; don't import `dom.ts` directly in tests.
- Adding a new element means adding it to `index.html`, `dom.ts`, and the `idMap` in `ui.test.ts`.

### Theming

A theme is a `theme-<name>` class on `<body>`; all styling lives under that selector in one `src/css/theme-<name>.css` file that defines CSS custom properties (brand colors, ball colors, shadows) and then every component rule. Themes are fully independent stylesheets, not overrides of a base; copy an existing one (the IPL ones share a layout) when adding a new one. `applyTheme()` falls back to `modern` for unknown names.

Adding a theme touches five places: the CSS file, the `import` in `theme.ts`, the `AVAILABLE_THEMES` array in `theme.ts`, a `theme-tag tag-<name>` span in `index.html` plus its `.tag-<name>` color in `instructions.css`, and the theme lists in README.md/architecture.md.

Ball indicator colors come from `getBallStyleClass()` in `utils.ts`, which maps outcome strings (`W`, `1wd`, `nb`, `4`, `.`) to classes (`wicket`, `wide`, `run-4`, `dot`, …) that each theme styles.

### Link Live Stream (`src/liveStream.ts`)

Attaches a YouTube URL to a CricClubs match via `updateLiveStreamURLFromCP.do`. CricClubs blocks this endpoint as a cross-origin subresource (CORP + WAF), so `fetch` (even `no-cors`), `<img>`, and `<iframe>` all fail. The working approach is a real top-level navigation: `window.open` in a small popup, synchronously inside the submit handler, closed after ~2s. Do not "simplify" this back to `fetch`; commits `25ceb63` and `f7459e3` document the failed attempts. There is also no client-side way to verify the update landed (the feed lags by up to a minute), so success copy says "submitted", not "linked".

## Notes

- `CONFIG` (`src/config.ts`) holds the refresh rate, the default club ID (LPCL, `1089463`), and the `?logo=` → sponsor image map pointing at `assets/images/`.
- Team logo URLs from the API may be relative; `updateTeamLogos()` prefixes `https://cricclubs.com` and caches by URL so polling doesn't refetch images.
- `feature-ideas.md` lists unused API fields (run rates, partnership, last wicket, MOM, etc.) that are already typed in `types.ts` if you're asked to add overlay features.
- Branch naming in history is `feature/…`, `fix/…`, `docs/…`; commit subjects use conventional prefixes (`feat:`, `fix:`, `docs:`, `ci:`, `test:`).
