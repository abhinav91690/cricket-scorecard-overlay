# Stream Overlay

A professional, lightweight cricket scorecard overlay designed for live streaming. This overlay fetches real-time data from CricClubs or can be used with mock data for testing.

## Development

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Start Dev Server:**
    ```bash
    npm run dev
    ```
    This will start a local server (usually at `http://localhost:5173`).

## Build

To create a production build:
```bash
npm run build
```
The output will be in the `dist` directory.


## Testing

This project includes a unit testing framework powered by [Vitest](https://vitest.dev/).

### Running Tests
To run the automated tests:

1.  **Watch Mode:** (Useful during development)
    ```bash
    npm run test
    ```
2.  **Single Run:** (Used in CI/Build)
    ```bash
    npm run test:run
    ```

> Tests are automatically run before every build to prevent regressions.

## Quick Start

1.  **Start a Local Server**
    You need to serve the files over HTTP. You can use Python's built-in server:
    ```bash
    python3 -m http.server 8000
    ```

2.  **Open in Browser / OBS**
    Navigate to the URL with your match ID:
    ```
    http://localhost:8000/?matchId=YOUR_MATCH_ID
    ```
    Add this URL as a **Browser Source** in OBS or your streaming software.

## Query Parameters

Customize the overlay using the following URL parameters:

| Parameter | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `matchId` | **Required**. The unique ID of the match on CricClubs. | None | `?matchId=1939` |
| `clubId` | The Club ID on CricClubs. | `1089463` (LPCL) | `?clubId=12345` |
| `theme` | The visual style of the overlay. Options: `modern`, `classic`. | `modern` | `?theme=classic` |
| `logo` | Displays a pre-configured sponsor/tournament logo. | None | `?logo=1` |
| `debug` | Uses mock data for testing without a live match. | None | `?debug=1` |
| `mode` | Enable special modes like `replay`. | `?mode=replay` |

## Themes

- **Modern (Default)**: A vibrant, glassmorphism-inspired design with animations.
- **Classic**: A traditional, cleaner broadcast look.

To use the classic theme:
```
http://localhost:8000/?matchId=1939&theme=classic
```

## Visual Debugging

You can test the overlay layouts without a live match ID by using the `debug` parameter:

- `?debug=1` : **1st Innings** (Batting view)
- `?debug=2` : **2nd Innings** (Chase view)
- `?debug=3` : **Match Ended** (Result view)
- `?debug=4` : **Toss** (Pre-match view)

## Customization

### Logos
The `logo` parameter maps to images defined in `script.js`.
- `?logo=1` -> Pulte Homes
- `?logo=2` -> Perry Homes

To add more logos, update the `LOGO_MAP` in `script.js`.
