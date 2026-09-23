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

## 4c. 🛑 httplib2 breaks resumable uploads unless redirects are off

A second httplib2 fault, independent of the CA one in §4b and hidden behind it. Google answers
every accepted chunk of a resumable upload with **308 "Resume Incomplete"**, and
`googleapiclient._process_response` is written to expect that 308. httplib2 0.32 lists 308 in
`REDIRECT_CODES` and, for a `PUT`, tries to follow it — then fails with:

```
httplib2.error.RedirectMissingLocation: Redirected but the response is missing a Location: header.
```

A Resume Incomplete has no `Location`, so it cannot be followed. `authorized_http()` sets
`http.follow_redirects = False`; googleapis endpoints do not redirect, so nothing is lost.

⚠ **This only bites a MULTI-chunk upload, which is why it stayed hidden.** A file smaller than
`chunksize` (8 MB) goes up in a single request and never sees a 308. The 0.7 MB lock test passed
clean; the first real reel, 20.7 MB, failed immediately. **A test fixture smaller than the
chunk size does not exercise the upload path at all** — the same shape as the harness faults in
[highlights.md](./highlights.md) §7b.

⚠ And `follow_redirects` is an **attribute, not a constructor argument** —
`httplib2.Http(follow_redirects=False)` raises `TypeError`.

## 4d. Per-player reels use `--meta`, not `--moment`

A per-player reel spans several balls, so no single moment describes it. `reels.py` writes a
`{title, description, tags}` sidecar per reel and `--meta <json>` uses it verbatim, bypassing
`reel_metadata()`. Reels are named `<player>-batting` / `<player>-bowling`, since one player
can have both. See [highlights.md](./highlights.md) §13b and §13aa.

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

## 8. Instagram Reels

Same reels, second platform. The R2 half is built and verified (§8c); the Meta half needs a
one-time app setup (§8b).

### 8a. ✅ Settled facts

- **The account must be Professional** — Business *or* Creator, both work. Personal accounts
  are excluded from the API entirely. ⚠ This resolves an earlier note here that said sources
  disagreed: they don't, only Personal is locked out. Topguns Cricket Club is already
  Professional.
- ✅ **No app review.** Leave the app in **Development mode**. Review only applies to
  publishing on behalf of accounts you do not own.
- 🛑 **There is no file upload.** Meta *fetches* the video, so a Reel needs a reachable
  `video_url`. That is the whole architectural cost, and it is what R2 solves.
- **100 API posts per rolling 24 h** per account — far past a match's worth of reels.
- ⚠ **Creator vs Business only changes the music library** (Creator gets trending audio,
  Business is limited to the ~14,000-track commercially cleared collection). Irrelevant to
  these reels: `cut.py` keeps the clip's own match audio and we never add a soundtrack. It
  only matters for Reels posted by hand.

### 8b. 🛑 The app setup, and the one path that avoids a Facebook Page

Meta offers two configurations, and the difference matters:

| | Facebook Page needed? | Publishing scope |
|---|---|---|
| **Instagram API with Instagram Login** | **No** | `instagram_business_content_publish` |
| Instagram API with Facebook Login for Business | **Yes** — a linked Page | `instagram_content_publish` |

**Use Instagram Login.** Content publishing is supported on it, and it needs no Facebook Page
— the club has an Instagram account, not necessarily a Page.

Steps, at [developers.facebook.com](https://developers.facebook.com/apps):

1. **Create app** → app type **Business**. 🛑 Not "Consumer" — the Instagram Login docs say
   plainly that a non-Business app type has to be recreated, so picking wrong costs a rebuild.
2. Add the **Instagram** product, and choose **API setup with Instagram login**.
3. Under **App roles**, add the club's Instagram account as an **Instagram Tester**, then
   accept the invitation from *inside Instagram* (Settings → Website permissions → Tester
   invites). An unaccepted invitation looks exactly like a permissions failure later.
4. Request the scopes `instagram_business_basic` and `instagram_business_content_publish`.
   In Development mode these are granted without review.
5. Generate a token from the App Dashboard. Store it with the same Keychain discipline as
   everything else — never in the repo, never in `argv`.

### 8c. ✅ The hosting half is built

`r2creds.py` holds the R2 S3 credentials in the Keychain (clipboard-driven, adapted from the
homelab script, §4a). `r2.py` uploads, presigns and deletes, with **SigV4 implemented in
stdlib** rather than pulling in ~50 MB of botocore for three operations.

Hand-rolling request signing is normally a bad idea. It is defensible here for one reason:
**a signing bug fails loudly.** A wrong signature is a 403 — it can never produce a
wrong-but-accepted result.

`r2.py --selftest` proves the chain against the live bucket, and the selftest was itself
checked for the ways it could pass for free:

| Probe | Result |
|---|---|
| Is the bucket public? | **HTTP 400 unsigned** — so a successful presigned GET really is testing the signature |
| Wrong secret | 403 |
| Wrong access key id | 401 |
| Presign expired 2 s ago | 403 — expiry is enforced server-side |
| Tampered key inside the URL | 403 |

⚠ **That first probe is the one that matters.** With a public bucket the presign test would
pass with a completely broken signer.

Real-size round trip, 16.7 MB: PUT 2.1 s, presigned GET 0.8 s byte-exact, `video/mp4`, exact
content-length, DELETE 204. **A Range request returns 206** — Meta probes with partial
requests before pulling the whole file, so that path had to work.

Bucket `overlay-reels`, WNAM, **Standard** storage class — the free tier does not cover
Infrequent Access. At ~1.1 GB per match deleted the same day, that is under 0.5% of the
10 GB-month allowance; egress is free on R2 at every tier, which is the line item that would
cost money anywhere else.

### 8d. 🛑 The 60-day token trap, worse than YouTube's

A long-lived Instagram token lasts **60 days**. It is refreshable:

```
GET https://graph.instagram.com/refresh_access_token
    ?grant_type=ig_refresh_token&access_token=<token>
```

🛑 **A token not refreshed within 60 days expires and can never be refreshed** — the whole
OAuth has to be redone. And **using the token does not extend it**; only an explicit refresh
does.

⚠ **The off-season is the hazard.** Publishing weekly during a season keeps nobody honest,
because use is not refresh — but a gap longer than 60 days between matches kills the token
silently, and the next match day starts with a broken uploader. This is the same shape as the
7-day OAuth trap in §3, with a longer fuse and a worse failure: YouTube's re-auth is a
browser round trip, this one is the full app flow again.

So the uploader should **refresh opportunistically on every run** (a token at least 24 h old
can be refreshed) and warn when expiry is inside ~10 days.

### 8e. 🛑 There is no private-first option

Our entire YouTube safety model — upload private, watch it, flip to public — **has no
Instagram equivalent**. A publish is live the moment it succeeds; the only remedy is deleting
it afterwards.

Consequences for the design: the review happens *before* the call, `--confirm` is
load-bearing in a way it is not for YouTube, and Instagram publishing should stay
**manual-trigger only** — never wired to fire automatically off a scan.

### 8f. The publish flow — built (`igpublish.py`)

Three calls, and the middle one is what write-ups omit:

1. `POST /<ig-user-id>/media` — `media_type=REELS`, `video_url=<presigned>`, `caption`
2. **`GET /<container-id>?fields=status_code` until `FINISHED`** — Meta transcodes the
   fetched video asynchronously, and publishing an `IN_PROGRESS` container fails. Statuses
   are `IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED` (unpublished for 24 h), `PUBLISHED`.
3. `POST /<ig-user-id>/media_publish` — `creation_id`

Then the R2 object is deleted in a `finally`, so a failure part-way through does not leave
an orphan accruing storage.

Host is **`graph.instagram.com`** — the Instagram Login path, not `graph.facebook.com`.

#### Documented Reels limits, and how our reels compare

| Spec | Limit | Ours |
|---|---|---|
| File size | **300 MB** | ~20–75 MB ✅ |
| Duration | 3 s – 15 min | 6–60 s ✅ |
| Video bitrate | 25 Mbps VBR | 10 Mbps ✅ |
| Horizontal pixels | 1920 | 1080 ✅ |
| Audio | 128 kbps AAC | 128 kbps ✅ |
| Aspect | 0.01:1–10:1 required | 1:1 / 4:5 ✅ accepted |

⚠ **A secondary source claimed 8 MB.** That is the **image** limit, mis-attributed — it
appears alongside image-only specs like sRGB conversion. Meta's own `ig-user/media`
reference says 300 MB for Reels video. Worth recording because an 8 MB ceiling would have
forced re-encoding every reel for nothing. Third time this project has been misled by a
secondary source on a size limit.

⚠ **9:16 is recommended, and may decide Reels-tab placement.** Meta says 9:16 avoids
"cropping or blank space". Secondary sources go further and claim only ~9:16 clips reach
the Reels *tab*, others landing in the feed as an ordinary video post — Meta's reference
does not say that, so `reel_notes()` warns rather than refuses. If Reels-tab placement
matters, `reels.py --aspect-bat 9:16` exists; the trade-off is that 9:16 cannot hold both
batting ends (§13a in [highlights.md](./highlights.md)), so it is a per-platform choice.

`reel_problems()` refuses before uploading, so a bad file costs nothing. Verified it can
actually refuse: a 2 s clip → "under Instagram's 3s minimum"; a 3000×400 file → "exceeds
the 1920 horizontal-pixel maximum"; the real 9:16 reel → accepted.

⚠ `reels.py` writes `#Shorts` for YouTube discovery, which means nothing on Instagram.
`caption_from()` swaps it for `#Reels` rather than maintaining two near-identical sidecars.

🛑 **Ask Instagram for the permalink; never build one.** A reel's URL uses a **shortcode**,
not the numeric media id, so `instagram.com/reel/<media_id>/` 404s — and it does so exactly
when the link is needed most, to go and delete a post. `GET /<media-id>?fields=permalink`
returns the real one.

### 8g. ✅ Verified live

Published a 14 s 9:16 clip cut from the reference match to @topgunscricketclub on
23 Sep 2026, then deleted it:

```
uploading to R2 … ok
creating the Reels container … ok
waiting for Meta to transcode:
    IN_PROGRESS
    FINISHED
publishing … ok
removing from R2 … HTTP 204
```

`media_product_type: REELS`, so it landed as a Reel rather than a feed video. R2 held **0
objects** afterwards — the `finally` cleanup works. The transcode took one poll interval,
well inside the 5-minute budget.

✅ **Re-cut properly and republished**, this time through `cut.segments()` from the computed
card time (3818 s, window 3798–3824). Verified *before* publishing by reading the burnt-in
scorebar at each end of the clip — 80/2 at 9 ov going in, 86/2 at 9.1 ov coming out, so the six
is provably inside. That technique is now [highlights.md](./highlights.md) §6a.

⚠ **The first attempt: the publish worked; the clip was wrong.** It showed the batter waiting and never the six,
because the test clip was cut with raw `ffmpeg -ss` instead of through `cut.segments()`, and
from a mis-converted timestamp. The window ended 9 s before the ball. Nothing to do with
Instagram — see [highlights.md](./highlights.md) §6, now a 🛑 tripwire. Worth recording here
because "the upload succeeded" and "the reel is any good" are separate claims, and only the
first was verified by this run.

