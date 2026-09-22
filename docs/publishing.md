---
type: Operations Reference
title: Publishing — reels to YouTube Shorts, highlights to YouTube
description: "How a cut reel reaches a channel: why our own unverified project can only publish locked-private videos and how uploading through Make's audited project gets round it, the one-time Google Cloud setup, the OAuth trap that kills an unattended uploader weekly, why a Short needs no special endpoint but does need validating, and where Instagram stands."
tags: [publishing, youtube, shorts, oauth, instagram, reels, make, webhook]
status: stable
generated: { by: claude/opus-5, at: 2026-09-21T22:32:46Z }
---

# publishing.md — getting reels onto a channel

**Load before touching `highlights/publish.py` or setting up the API credentials.**

`publish.py` uploads a cut file to YouTube. Two targets: a vertical reel as a **Short**, and the
full highlights video as an ordinary video. Instagram is **not built** — see §8.

---

## 0. ✅ Measured: this project uploads public videos fine

**The direct API route works.** On 21 Sep 2026 `publish.py --privacy public --confirm` uploaded
through this project's own unverified OAuth client, and it passed all three checks a locked video
fails:

| Check | Result |
|---|---|
| Studio | **Visibility Public**, and the **Notices panel empty** |
| Signed-out load | played in an incognito window |
| Visibility change | **Public → Private succeeded** |

No lock. It also landed on a `youtube.com/shorts/…` URL, so Shorts classification works on this
route too.

That matters because the opposite was written here as settled fact for most of a day, and a
lot of work was done around it.

### 0a. 🛑 What the docs say, and why it was believed

Google's [support page](https://support.google.com/youtube/answer/7300965?hl=en) states that a
video uploaded through `videos.insert` from an **unverified API project created after 28 July
2020** is **locked private**, unappealably:

> "For videos that have been locked as private due to upload via an unverified API service, you
> will not be able to appeal."

That is real, documented, and it is why `--metadata-only` exists. What was wrong was treating it
as **certain to apply here without ever testing it** — the OAuth consent wall (§3a) came first,
the upload never completed, and the untested assumption was written up as a 🛑 tripwire.

🛑 **Never record an untested platform restriction as a tripwire.** It sent the whole publishing
design down a detour: a Make.com account, a scenario, a webhook, a Keychain entry pair and an
R2 hosting plan, all to route around a wall that was never measured. The measurement was ten
minutes and one throwaway clip.

### 0b. ⚠ It may still apply — what to watch

One public upload does not prove the policy is inert. Enforcement could be asynchronous, or
scoped to patterns this has not hit. So:

- **Re-check a public upload the next day** before trusting the route for anything that matters.
  A lock that arrives late looks exactly like this did at first.
- ⚠ **`oembed` is not the check** — see §5c. A signed-out browser load is.
- Keep `--metadata-only` working. It is the fallback if a lock ever does arrive, and it costs
  nothing to retain.

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

### 3a. ⚠ Testing mode also blocks accounts outright, which looks nothing like the above

In **Testing**, only accounts on the **Test users** list can authorise at all. Any other account
gets a hard failure at the consent screen, not a warning you can click through:

```
Error 403: access_denied
<app> has not completed the Google verification process.
The app is currently being tested, and can only be accessed by developer-approved testers.
```

This bites when the Cloud project and the **channel's** Google account are different logins,
which is the normal case for a club channel. Two fixes:

| Fix | Effect |
|---|---|
| Add the channel account under **Test users** | unblocks immediately, but the 7-day token expiry in §3 applies |
| **Publish the app to "In production"** | no 7-day expiry; an unverified sensitive scope then shows a clickable "Google hasn't verified this app" warning instead, and the project is capped at 100 users — irrelevant for one |

Publishing to production is the right answer here. Neither fix lifts the upload lock in §0;
they are separate gates.

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

## 4b. 🛑 httplib2 does not use the system trust store, and ignores both CA env vars

Behind the corporate proxy the upload died on
`CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate` — **after** the OAuth
consent had completed and the token had been written to the Keychain.

That split is the confusing part and it points the wrong way:

| Transport | Trust store | Behind Zscaler |
|---|---|---|
| `requests` (the OAuth token exchange) | honours `REQUESTS_CA_BUNDLE` | ✅ works |
| `httplib2` (every `googleapiclient` call) | **its own `certifi` bundle** | ❌ fails |

So the credential is fine and the token is valid; only the upload transport distrusts the
proxy's root. It reads like a broken credential or a revoked consent, and neither is true.

⚠ **Setting `SSL_CERT_FILE` does not fix it.** httplib2 reads neither that nor
`REQUESTS_CA_BUNDLE`; it defaults to whatever `certifi` ships. The bundle has to be handed over
explicitly, which is what `authorized_http()` does:

```python
http = httplib2.Http(ca_certs=ca_bundle())          # ca_bundle() finds the corp root
yt = build("youtube", "v3", http=authorized_http(credentials()))
```

🛑 `http=` and `credentials=` are **mutually exclusive** in `build()` — the transport carries the
credentials. And note this is a *different* failure from the `VERIFY_X509_STRICT` one in
`ssl_context()`: that one says "Basic Constraints of CA cert not marked critical" and needs a
flag cleared, this one says "unable to get local issuer certificate" and needs a bundle. Same
proxy, two unrelated fixes. See [deployment.md](./deployment.md) §3.

## 5. The Make.com route — works, but no longer needed

⚠ **Read §0 first: the direct API uploads public videos fine, so this route solves a problem
this project does not have.** It is kept because it is built, tested and harmless as a fallback,
and because §5a/§5c hold lessons worth not relearning. It should not be anyone's first choice —
it adds a third party holding an OAuth token for the channel, a monthly fee above 5 MB, and a
file-size ceiling the direct API does not have.

Tested end to end on 21 Sep 2026, and it does work:

| Signal | Result |
|---|---|
| Make execution | Success, 2 operations, 2.3 s in the YouTube module |
| API response | `uploadStatus: uploaded`, `privacyStatus: public` |
| YouTube Studio | Visibility **Public**, and the **Notices panel empty** |
| Classification | landed on a `youtube.com/shorts/…` URL — YouTube read it as a Short |
| Signed-out load | played in an incognito window, so genuinely public |
| Visibility change | **Public → Private succeeded** afterwards |

🛑 **The evidence that matters is that visibility could still be changed.** A video locked
under §0 is stuck: Studio shows it Private, with a notice saying so, and the setting cannot be
moved. This one went Public → Private on request. The empty Notices panel agrees, and the word
"Public" on its own would have proved neither.

⚠ **What this test did *not* establish** is that the audited-project theory is why it worked.
The direct API — an *unverified* project — behaves identically (§0). So this result is
consistent with "Make's project is audited" and equally with "the lock simply does not bite
here". The experiment had no control, and I presented it as though it did.

### 5c. 🛑 `oembed` is not a visibility test for a Short

`https://www.youtube.com/oembed?url=…` answered **401 for the whole observation window** — with
both the `watch?v=` and `/shorts/` URL forms — while the video was **already loading fine in a
signed-out incognito window**. The controls were clean (a known-public video 200, a nonexistent
id 400), so the instrument was working; it simply does not resolve fresh Shorts, and 401 there
means nothing about visibility.

⚠ **I nearly recorded this as evidence the lock had applied**, and then as propagation lag that
would clear. It was neither. A signed-out browser load is the check that actually answers the
question; oEmbed is the wrong instrument for a Short, not a slow one.

### 5a. 🛑 What the webhook route cannot do

- **`--privacy` is ignored.** The Make module sets Privacy Status **statically**, so the field in
  the POST is decoration. Whatever the flag says, the video lands at whatever the scenario is
  configured for. `post_to_webhook()` prints this every run rather than letting the dry-run
  output imply our flag is in control. Changing visibility means editing the scenario.
- 🛑 **5 MB per file on Make's free plan — and hosting the file does not get round it.** This
  is a **plan-level limit on any file a scenario handles**, not a webhook limit, so pointing
  Make at a file on R2 with `HTTP › Get a file` hits exactly the same ceiling; people have run
  into it on that module and been told only to upgrade. The limit rises with the tier —
  **Core 100 MB, Pro 250 MB, Teams 500 MB, Enterprise 1 GB** — so a ~20 MB reel needs **Core**,
  the cheapest paid plan. `post_to_webhook()` refuses up front rather than failing mid-transfer.

  ⚠ **This corrects an earlier note here** that said the ceiling was 5 MB "on every tier" and
  that hosting the file would remove it. Both were wrong, and together they pointed at building
  R2 hosting that would not have helped. Sources:
  [Working with files](https://help.make.com/working-with-files),
  [HTTP get file url — max file size exceeded](https://community.make.com/t/http-get-file-url-max-file-size-exceeded/45099).
- The scenario must be **saved *and* active**. Make answers **410 Gone** for a hook with nothing
  live behind it, which reads like a bad URL and is not.

### 5b. The scenario

`Integration Webhooks, YouTube` — a Custom webhook feeding `YouTube › Upload a Video` (v4).
Four mapped fields: `1.title`, `1.video.name`, `1.video.data`, `1.description`. Category Sports.
Made-for-kids **No**, synthetic media **No**, notify subscribers **No** — the last of those keeps
a test upload from notifying the channel's subscribers, which is worth keeping set.

🛑 The webhook URL and its API key live in the **Keychain**
(`cricket-overlay-make-webhook-url`, `cricket-overlay-make-webhook-key`), never in this repo,
which is public. The key travels in the `x-make-apikey` header; without it the hook answers 403,
which is the point — the URL alone is not a credential.

## 6. 🛑 A Short needs no special endpoint — but it does need validating

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

## 7. Captions come from the QR payload

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

## 8. Instagram: researched, not built

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

## 9. Use

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
