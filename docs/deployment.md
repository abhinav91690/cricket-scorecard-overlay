---
type: Operations Reference
title: Deployment — Netlify, Cloudflare, deploy previews and the corporate CA
description: "How the site and the Worker reach production, how to get a public preview URL a phone can load, and the Zscaler certificate problem that makes wrangler and Node fetch fail in a fresh shell."
tags: [deployment, netlify, cloudflare, wrangler, zscaler, ci]
status: stable
generated: { by: claude/opus-5, at: 2026-09-21T22:32:46Z }
---

# deployment.md — getting things to production

**Load before deploying, or before debugging a TLS failure on this machine.**

---

## 1. The site

**Netlify builds `main`** (`npm run build`, publish `dist/`) and serves it as
**https://score.abhinav.dev**, proxied through Cloudflare. There is nothing to deploy beyond
merging.

`vite.config.ts` sets `base: './'` so overlay paths stay relative. 🛑 **Don't change it.**

Anything in `public/` is copied verbatim into `dist/`, so a standalone file lands at the site
root — useful for one-off diagnostics that must be reachable by URL.

## 2. ✅ Deploy previews give a public URL a phone can load

The Netlify site is **`score-overlay`**, and deploy previews are enabled, so **every PR gets**:

```
https://deploy-preview-<N>--score-overlay.netlify.app
```

That URL is public and needs no login, which matters because **a browser source in a phone app
cannot open anything behind authentication** — an artifact link or a private host is unreachable
from IRL Pro's webview. A PR preview is the cheapest way to put a page in front of it without
touching production.

Verified against PRs 11, 12, 13 and used in anger for PR 14 (the audio probe): the preview was
live about 30 seconds after the push.

⚠ **`localhost` is not reachable from a phone either.** For a LAN test run
`npm run dev -- --host 0.0.0.0` and use the machine's LAN address; both devices must be on the
same Wi-Fi. Note the analytics caveat in [analytics.md](./analytics.md) §1 — a LAN IP is not
localhost, so use `?debug=1` or `?mode=replay`.

## 3. 🛑 The corporate CA breaks Node and wrangler in a fresh shell

This machine runs Zscaler, which terminates TLS with its own root. Node does not use the system
trust store, so anything that fetches — `wrangler`, `npm` against some registries, a plain
`fetch()` in a script — fails with:

```
UNABLE_TO_GET_ISSUER_CERT_LOCALLY
```

`~/.zshrc` provides `NODE_EXTRA_CA_CERTS` pointing at the corporate root. ⚠ **If a command
fails this way, that variable is not set in the current shell** — a non-interactive or
tool-spawned shell does not necessarily source `~/.zshrc`. Prefix the command with it rather
than concluding the network is broken.

⚠ **Homebrew is unusable through the same proxy.** Its Portable Ruby download reaches 100% then
fails with `curl: (92) HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR`. This is why
`highlights/` gets ffmpeg from PyPI (`imageio-ffmpeg`) instead of a system install, and why
PyPI wheels are the right default for tooling here.

⚠ **Python is externally managed (PEP 668)**, so `pip install --user` is refused. Use a venv.

## 4. The Worker

Deployed **manually, on purpose** — the reasoning and the commands are in
[analytics.md](./analytics.md) §4 and §8.

## 5. CI

`.github/workflows/ci.yml` runs the site build and the Worker typecheck/tests on every PR.

⚠ **`npm run build` fails on type errors *and* test failures**, so it is the real gate. Run it
locally before opening a PR; CI will only tell you the same thing more slowly.

`.github/workflows/deploy-worker.yml` exists but skips itself — see
[analytics.md](./analytics.md) §4.

## 6. Branch and commit conventions

Branch names in history: `feature/…`, `fix/…`, `docs/…`, `design/…`, `test/…`. Commit subjects
use conventional prefixes: `feat:`, `fix:`, `docs:`, `ci:`, `test:`, `perf:`, `build:`,
`revert:`.

⚠ **Recordings are gitignored and must stay that way.** `test video/`, `*.mp4`, `*.mov`, `*.mkv`
are excluded — a 26 GB capture once sat untracked in this public repo with no rule covering it.

🛑 **That ignore rule is not yet on `main`.** It exists on `feature/highlight-markers` and needs
to ride along with whichever PR lands first.
