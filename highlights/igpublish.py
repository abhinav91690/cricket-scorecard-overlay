"""Publish a reel to Instagram: R2 -> presigned URL -> container -> poll -> publish.

Meta *fetches* the video rather than accepting an upload, so the file goes to R2, Meta pulls
it from a presigned URL, and it is deleted again. See docs/publishing.md §8.

🛑 THERE IS NO PRIVATE-FIRST OPTION. The whole YouTube safety model — upload private, watch
it, flip to public — has no Instagram equivalent. A publish is live the moment it succeeds
and the only remedy is deleting it afterwards. So:
  · nothing publishes without --confirm
  · this is manual-trigger only; never wire it to fire off a scan
  · the review happens BEFORE the call, which is what the "watch them first" workflow is

Three calls, not two, and the middle one is the one write-ups omit:
  1. POST /<ig-user-id>/media          media_type=REELS, video_url, caption
  2. GET  /<container-id>?fields=status_code   poll until FINISHED
  3. POST /<ig-user-id>/media_publish  creation_id

Usage:
    .venv/bin/python igpublish.py reels/v-kohli-batting-4x5.mp4 \\
        --meta reels/v-kohli-batting-4x5.json            # dry run
    ... --confirm                                         # actually publish
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

import igcreds
import r2
from publish import clip, clip_body, probe, ssl_context

GRAPH = "https://graph.instagram.com"

# Meta's documented Reels limits (developers.facebook.com, ig-user/media reference).
MAX_BYTES = 300 * 1024 * 1024
MIN_SECONDS = 3.0
MAX_SECONDS = 15 * 60
MAX_WIDTH = 1920
ASPECT_MIN, ASPECT_MAX = 0.01, 10.0

CAPTION_MAX = 2200          # Instagram caption limit
POLL_EVERY = 10             # seconds; Meta suggests ~once a minute for up to 5 minutes
POLL_FOR = 300


def reel_problems(path: str) -> list[str]:
    """Reasons Instagram would reject or mangle this file. Empty list means fine.

    ⚠ Checked BEFORE uploading, because the alternative is a failed container and a
    wasted R2 round trip — and because a file that publishes but is not eligible for the
    Reels tab looks like success.
    """
    problems = []
    size = os.path.getsize(path)
    if size > MAX_BYTES:
        problems.append(f"{size/1e6:.0f} MB exceeds Instagram's 300 MB Reels limit")

    m = probe(path)
    w, h, dur = m["w"], m["h"], m["duration"]
    # probe() returns zeros rather than None when it cannot parse ffprobe's output, so
    # this has to be an explicit check — otherwise a 0x0 file sails through every limit.
    if not w or not h or not dur:
        return ["could not read the video's dimensions or duration — refusing to guess"]
    if dur < MIN_SECONDS:
        problems.append(f"{dur:.1f}s is under Instagram's 3s minimum")
    if dur > MAX_SECONDS:
        problems.append(f"{dur/60:.1f} min exceeds the 15 min maximum")
    if w > MAX_WIDTH:
        problems.append(f"{w}px wide exceeds the 1920 horizontal-pixel maximum")
    ratio = w / h if h else 0
    if not (ASPECT_MIN <= ratio <= ASPECT_MAX):
        problems.append(f"aspect {ratio:.2f}:1 is outside the accepted 0.01:1–10:1")
    return problems


def reel_notes(path: str) -> list[str]:
    """Things that will publish fine but may not behave as hoped. Warnings, not refusals."""
    notes = []
    m = probe(path)
    w, h = m.get("w", 0), m.get("h", 0)
    if w and h:
        ratio = h / w
        target = 16 / 9
        # ⚠ Meta recommends 9:16 "to prevent cropping or blank space". Secondary sources
        # also claim only ~9:16 clips reach the Reels TAB, others landing in the feed as a
        # normal video post. Meta's own reference does not say that, so this is a note and
        # not a refusal — but it is why --aspect 9:16 exists in reels.py.
        if abs(ratio - target) > 0.2:
            notes.append(f"{w}x{h} is {ratio:.2f}:1 tall, not 9:16 — Meta recommends 9:16 "
                         "to avoid cropping or blank space, and non-9:16 clips may land in "
                         "the feed rather than the Reels tab")
    return notes


def _post(path: str, **params) -> dict:
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(f"{GRAPH}{path}", data=data, method="POST")
    return _send(req)


def _get(path: str, **params) -> dict:
    url = f"{GRAPH}{path}?" + urllib.parse.urlencode(params)
    return _send(urllib.request.Request(url))


def _send(req: urllib.request.Request) -> dict:
    try:
        with urllib.request.urlopen(req, context=ssl_context()) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read(600).decode(errors="replace")
        try:
            err = json.loads(raw).get("error", {})
            msg = err.get("error_user_msg") or err.get("message") or raw
        except Exception:
            msg = raw
        raise SystemExit(f"Instagram API HTTP {e.code}: {msg}")


def create_container(creds: dict, video_url: str, caption: str) -> str:
    out = _post(f"/{creds['ig_user_id']}/media", media_type="REELS",
                video_url=video_url, caption=caption, access_token=creds["token"])
    cid = out.get("id")
    if not cid:
        raise SystemExit(f"no container id in the response: {out}")
    return cid


def wait_for_container(creds: dict, cid: str) -> None:
    """Block until the container reports FINISHED.

    🛑 Publishing a container that is still IN_PROGRESS fails. Meta transcodes the fetched
    video asynchronously, so this poll is mandatory, not a nicety.
    """
    deadline = time.time() + POLL_FOR
    last = ""
    while time.time() < deadline:
        out = _get(f"/{cid}", fields="status_code,status", access_token=creds["token"])
        code = out.get("status_code", "")
        if code != last:
            print(f"    {code}", flush=True)
            last = code
        if code == "FINISHED":
            return
        if code in ("ERROR", "EXPIRED"):
            # Surface Meta's own explanation; it names the actual problem with the file.
            raise SystemExit(f"container {code}: {out.get('status', '(no detail)')}")
        time.sleep(POLL_EVERY)
    raise SystemExit(f"container still {last or 'unknown'} after {POLL_FOR}s — giving up "
                     "rather than publishing something unprocessed")


def publish_container(creds: dict, cid: str) -> str:
    out = _post(f"/{creds['ig_user_id']}/media_publish", creation_id=cid,
                access_token=creds["token"])
    mid = out.get("id")
    if not mid:
        raise SystemExit(f"no media id in the response: {out}")
    return mid


def caption_from(meta_path: str | None, explicit: str | None) -> str:
    if explicit:
        return clip(explicit, CAPTION_MAX)
    if meta_path:
        meta = json.load(open(meta_path))
        body = meta.get("description", "")
        title = meta.get("title", "")
        # The sidecar's title is a scorecard line and its description carries the ball log;
        # Instagram has one caption field, so they are joined. clip_body keeps newlines.
        text = f"{title}\n\n{body}" if title else body
        # reels.py writes #Shorts for YouTube discovery, which means nothing on Instagram.
        # The sidecar is shared between both platforms, so swap it here rather than
        # producing two nearly identical caption files.
        text = text.replace("#Shorts", "#Reels")
        return clip_body(text, CAPTION_MAX)
    raise SystemExit("need --caption or --meta")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file")
    ap.add_argument("--meta", metavar="JSON", help="caption sidecar written by reels.py")
    ap.add_argument("--caption")
    ap.add_argument("--confirm", action="store_true",
                    help="actually publish. Without it, nothing is uploaded or posted")
    ap.add_argument("--keep", action="store_true",
                    help="leave the object in R2 afterwards (for debugging)")
    ap.add_argument("--expires", type=int, default=3600,
                    help="presigned URL lifetime; must outlast Meta's transcode")
    a = ap.parse_args()

    if not os.path.exists(a.file):
        raise SystemExit(f"no such file: {a.file}")

    m = probe(a.file)
    print(f"{a.file}\n  {m['w']}x{m['h']}, {m['duration']:.1f}s, "
          f"{os.path.getsize(a.file)/1e6:.1f} MB")

    problems = reel_problems(a.file)
    if problems:
        print("\n  🛑 Instagram would reject this:")
        for p in problems:
            print(f"      - {p}")
        raise SystemExit(1)
    for n in reel_notes(a.file):
        print(f"  ⚠ {n}")

    caption = caption_from(a.meta, a.caption)
    print("\n  caption")
    for line in caption.splitlines():
        print(f"    | {line}")

    print(f"\n  account   @{igcreds.stored().get('username', '?')}")
    left = igcreds.days_left(igcreds.stored())
    if left is not None and left <= 10:
        print(f"  ⚠ the access token expires in {left} day(s) — run igcreds.py --refresh")

    if not a.confirm:
        print("\n  DRY RUN — nothing uploaded, nothing published.")
        print("  🛑 Instagram has no private-first option: with --confirm this goes LIVE")
        print("     immediately and can only be undone by deleting the post.")
        return

    creds = igcreds.credentials()
    key = None
    try:
        print("\n  uploading to R2 …", end=" ", flush=True)
        key = r2.put(a.file)
        url = r2.presign_get(key, a.expires)
        print(f"ok ({key})")

        print("  creating the Reels container …", end=" ", flush=True)
        cid = create_container(creds, url, caption)
        print(f"ok ({cid})")

        print("  waiting for Meta to transcode:")
        wait_for_container(creds, cid)

        print("  publishing …", end=" ", flush=True)
        mid = publish_container(creds, cid)
        print("ok")
        # 🛑 Ask for the permalink; do not build one. Instagram's reel URLs use a
        # SHORTCODE, not the numeric media id, so a constructed link 404s — and it 404s
        # exactly when it is needed most, to go and delete a post.
        info = _get(f"/{mid}", fields="permalink,media_product_type",
                    access_token=creds["token"])
        link = info.get("permalink") or "(no permalink returned)"
        print(f"\n  ✅ published as {info.get('media_product_type', '?')}")
        print(f"     {link}")
        print(f"     (media id {mid})")
    finally:
        # Always clean up: Meta has already fetched by the time we publish, and an orphan
        # object would sit in the bucket accruing storage for nothing.
        if key and not a.keep:
            print(f"  removing from R2 … HTTP {r2.delete(key)}")
        elif key:
            print(f"  left in R2: {key}")


if __name__ == "__main__":
    main()
