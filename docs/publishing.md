---
type: Operations Reference
title: Publishing — reels to YouTube Shorts, highlights to YouTube
description: "How a cut reel reaches a channel: the one-time Google Cloud setup, the OAuth trap that kills an unattended uploader weekly, why a Short needs no special endpoint but does need validating, and where Instagram stands."
tags: [publishing, youtube, shorts, oauth, instagram, reels]
status: stable
generated: { by: claude/opus-5, at: 2026-09-21T22:32:46Z }
---

# publishing.md — getting reels onto a channel

**Load before touching `highlights/publish.py` or setting up the API credentials.**

`publish.py` uploads a cut file to YouTube. Two targets: a vertical reel as a **Short**, and the
full highlights video as an ordinary video. Instagram is **not built** — see §7.

---

## 1. Two safety defaults, both deliberate

This publishes to a public channel under someone's name, so:

- 🛑 **Nothing uploads without `--confirm`.** Without it the tool prints exactly what it would
  send and exits 0.
- 🛑 **Uploads default to `privacyStatus: private`.** Watch it on the channel, then make it
  public in YouTube Studio. `--privacy unlisted|public` overrides, but private is the default
  because a bad automated post under your own name is not recoverable.

## 2. ✅ Quota is not a constraint

`videos.insert` has **its own quota bucket with a 100-call daily limit**, separate from the
10,000-unit project pool — confirmed against Google's own
[quota page](https://developers.google.com/youtube/v3/determine_quota_cost). A match's worth of
reels plus the full video is nowhere near it.

⚠ This is a change. It used to cost ~1600 units against the shared 10,000, which capped you at
about six uploads a day, and that older figure is still all over the web.

## 3. 🛑 The OAuth trap: "Testing" expires refresh tokens after 7 days

If the OAuth consent screen is left in **Testing**, Google expires the refresh token after
exactly seven days. An unattended uploader then works for a week and silently stops, with
nothing in the logs to suggest why.

**Set the consent screen to "In Production"** in Google Cloud Console. `youtube.upload` is a
*sensitive* scope, not a restricted one, so a personal app does not need a security assessment —
you click through an "unverified app" warning once and the refresh token stops expiring.

`credentials()` prints a hint pointing at this whenever a refresh fails, because the symptom
(works, then doesn't, a week later) gives no clue on its own.

## 4. One-time setup

1. **Google Cloud Console** → new project → enable **YouTube Data API v3**.
2. **APIs & Services → Credentials → Create OAuth client → Desktop app** → download the JSON.
3. **OAuth consent screen → publish to "In Production"** (see §3 — skip this and it breaks in
   a week).
4. Move the downloaded file into the Keychain and delete it:

   ```sh
   .venv/bin/python publish.py --import-client ~/Downloads/client_secret_*.json
   rm ~/Downloads/client_secret_*.json
   ```

5. The first upload opens a browser for consent once; the token is stored automatically.

Two Keychain entries, both base64-encoded JSON:

| Service | Holds |
|---|---|
| `cricket-overlay-youtube-client` | the OAuth client, written by `--import-client` |
| `cricket-overlay-youtube-token` | the token, rewritten on every refresh |

## 4a. 🛑 Why the Keychain write is not a one-liner

Secrets go in the macOS Keychain, the same place the homelab repo keeps its tokens — never in
this repo, which is public. `keychain_write()` is adapted from that repo's `keychain-add.sh`,
and it exists because there are two separate ways this silently goes wrong:

- ⚠ **`security add-generic-password -w` with no value uses an interactive prompt that
  truncates at 128 characters, silently.** The Keychain stores long values fine — the prompt is
  the limit — and a short write is invisible until the API returns a clean 401 that looks like a
  bad credential rather than a bad paste. An OAuth token blob is around 500 characters.
- ⚠ **Passing `-w <value>` puts the secret in argv**, where `ps` can read it, and Jamf agents
  run as root on this Mac.

Feeding the command to `security -i` over **stdin** avoids both.

🛑 **And one difference from `keychain-add.sh`, which is why this does not just shell out to
it.** That script wraps the value in `"%s"` inside the `security` command, which is fine for a
JWT but breaks on JSON — a credentials blob contains about two dozen double quotes. Everything
here is **base64 encoded first**, so the stored value is always quote-free.

Verified live with a 529-character token blob containing 24 double quotes: stored as 708
characters of base64 and read back byte-identical. `keychain_write()` compares the read-back
**exactly**, not by length as the shell script does, since it has the original value in hand.

## 5. 🛑 A Short needs no special endpoint — but it does need validating

There is no Shorts API. `videos.insert` is the only upload call, and **YouTube decides a video
is a Short from the file itself**: vertical (or square) and short.

That means a 16:9 file uploaded as a "Short" produces **no error at all** — it just lands on the
channel as an ordinary video, and the only way to notice is to look. So `shorts_problems()`
checks before uploading and refuses unless `--force`:

| Check | Rule |
|---|---|
| Orientation | height ≥ width — 1:1 square counts |
| Duration | ≤ **60 s** |

⚠ **The 60 s ceiling is a deliberate choice, not the platform limit.** Sources disagree on
whether the cap is 60 s or 3 minutes. 60 satisfies every version of the rule *and* Instagram's
5–90 s window, so one encode serves both targets and there is nothing to decide later.

## 6. Captions come from the QR payload

`reel_metadata()` builds the title, description and tags from a moment in `events.json`. Each
moment already carries striker, bowler, score, the striker's own score, the ball number and the
outcome — see [data-code.md](./data-code.md) §2 — so a reel is captioned without anyone typing:

```
WICKET: V. Kohli b J. Bumrah · 31/1 | Topguns vs Bazzigarz
```

This is most of what the data code was for. A boundary off a no-ball reads "six off a no-ball",
so the `c455921` case survives all the way to the caption.

⚠ **`clip_body()` exists because descriptions must keep their line breaks.** YouTube only
renders chapter markers when the timestamps are on their own lines, and the first version of
this ran descriptions through the same whitespace-collapsing helper as titles — which silently
turned a chaptered video into one with none. Caught by
`test_chapters_go_at_the_top_of_the_description`.

⚠ **Chapters need at least three stamps, the first at `00:00`.** `cut.py` writes `00:00 Start`
first so that holds for a real match, but a short test reel produces too few and the tool says
so rather than pretending.

## 7. Instagram: researched, not built

An Instagram path was costed and deferred. What was established:

- ✅ **App review is not needed** for a single-user tool. Leave the Meta app in **Development
  mode** and give your own account the **Instagram Tester** role; review only starts when
  publishing on behalf of accounts you do not own. ⚠ This corrects an earlier belief that
  `instagram_business_content_publish` needed 2–4 weeks of review.
- ⚠ The account must be **Professional**. Sources disagree on whether Creator works or it must
  be Business — a two-minute check in the app when setting up.
- 🛑 **There is no file upload.** Meta's servers *fetch* the video, so
  `media_type=REELS` needs a **publicly reachable `video_url`**, then a second call to
  `/media_publish` with the container id. Limit is 100 API posts per 24 h per account.
- The public-URL requirement is the whole architectural cost. **Cloudflare R2** is free at this
  scale — 10 GB-month, 1 M writes, 10 M reads, and egress is free on R2 with no tier — against
  roughly 400 MB per match that gets deleted within minutes. A **Cloudflare Tunnel** serving a
  local file is the zero-storage alternative, but the tunnel has to stay up until Meta's
  container reports `FINISHED`.

## 8. Use

```sh
# a reel, captioned from the scan output
.venv/bin/python publish.py reel.mp4 --target shorts \
    --moments events.json --moment 3 --match "Topguns vs Bazzigarz — 2026 FTP20 Div-A"

# the full highlights video, with cut.py's chapters in the description
.venv/bin/python publish.py highlights.mp4 --target video \
    --match "Topguns vs Bazzigarz — 2026 FTP20 Div-A" --chapters highlights-chapters.txt

# add --confirm to actually upload; add --privacy unlisted|public to change visibility
```

`test_publish.py` covers the decision logic — the Shorts checks, the caption generation and
YouTube's field limits — with no network and no Google libraries. The Keychain path is not unit
tested, because a test that mutates the login Keychain is worse than no test; it was verified
live against a throwaway service name that was deleted afterwards.
