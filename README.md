# Cricket Scorecard Overlay

A professional, lightweight, and responsive cricket scorecard overlay designed for live streaming (OBS, vMix, etc.). It fetches real-time match data from the **CricClubs** API or runs in debug mode with mock data.

## Features
- **Real-Time Updates**: Polls the API automatically for live scores.
- **17 Themes**: Broadcast-style themes for every IPL franchise, plus core classic/modern/neon themes and a set of Topguns themes. See [Available Themes](#available-themes) below.
- **Link Live Stream**: A home-screen utility to attach a YouTube live stream link to a CricClubs match without leaving the overlay.
- **Self-Hosted Fonts**: Uses **Montserrat** (bundled) for consistent rendering across all devices without external dependencies.
- **Performance Optimized**: Zero layout shifts (CLS), minimal network footprint, and bundled CSS.
- **Developer Experience**: Built with **Vite** and **TypeScript**.
- **Automated Deployment**: One-click deployment to GitHub Pages via GitHub Actions.

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

Visiting the app with no `matchId` shows a home screen with setup instructions and the Link Live Stream form (see below) instead of the overlay.

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
| `theme` | No | One of the themes listed below (default: `modern`). | `?theme=kkr` |
| `debug` | No | Use mock data (1-5) instead of live API. | `?debug=1` |
| `mode` | No | Special modes like `replay`. | `?mode=replay` |
| `logo` | No | Displays specific sponsor logos. | `?logo=1` |

### Debug Modes
Test layouts without a live match:
- `?debug=1`: 1st Innings (Standard)
- `?debug=2`: 2nd Innings (Chasing)
- `?debug=3`: Match Ended
- `?debug=4`: Pre-match / Toss
- `?debug=5`: No Team Logos

### Available Themes
- **Core**: `classic`, `modern`, `neon`
- **IPL Franchises**: `kkr`, `rcb`, `mi`, `csk`, `dc`, `rr`, `srh`, `pbks`, `gt`, `lsg`
- **Topguns**: `tel`, `ted`, `tul`, `tud`

---

## Link Live Stream

The home screen (shown when no `matchId` is provided) includes a form to attach a YouTube live stream link to a CricClubs match: enter the Club ID (prefilled to the default), Match ID, and the YouTube URL, then submit.

---

## Deployment

This project expects to be hosted on **GitHub Pages**.

### Automated Deployment
A GitHub Actions workflow is included in `.github/workflows/deploy.yml`.
1.  Push changes to the `main` branch.
2.  The action builds the project and deploys it as an artifact.
3.  Ensure your repository settings are set to **Deploy from GitHub Actions** (Settings > Pages > Source).

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
```

See [architecture.md](architecture.md) for a deeper look at the project structure and data flow.
