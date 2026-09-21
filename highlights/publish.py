"""Upload a reel or a highlights video to YouTube.

Two targets, one endpoint. YouTube has no Shorts-specific API: `videos.insert` is the only
upload call, and YouTube decides a video is a Short from the file itself — vertical, and short.
So the only thing that separates `--target shorts` from `--target video` here is the metadata
and the validation, which is exactly why the validation matters: upload a 16:9 file expecting a
Short and you silently get an ordinary video on the channel.

Quota is not a constraint. `videos.insert` has its own bucket with a 100-call daily limit,
separate from the 10,000-unit project pool, so a match's worth of reels plus the full video is
nowhere near it.

SAFETY. This publishes to a public channel under someone's name, so two things are deliberate:
uploads default to `private` visibility, and nothing is sent without `--confirm`. Without it the
tool prints exactly what it would do and exits 0. Flip the video to public in YouTube Studio
once you have watched it.

🛑 Secrets never live in this repo — it is public. They go in the macOS Keychain, the same
place the homelab repo keeps its tokens. See docs/publishing.md.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

# Keychain services. The token is the durable secret and is written back on every refresh.
KC_TOKEN = "cricket-overlay-youtube-token"
KC_CLIENT = "cricket-overlay-youtube-client"
# Only used by --import-client, to move the file Google hands you into the Keychain.
CONFIG_DIR = Path.home() / ".config" / "cricket-scorecard-overlay"

# YouTube's own field limits.
TITLE_MAX = 100
DESC_MAX = 5000
# A Short is vertical and short. Sources disagree on 60s vs 3 minutes, so the tool holds the
# line at 60: it satisfies every version of the rule and Instagram's 5-90s window as well, so
# one encode serves both.
SHORTS_MAX_SECONDS = 60.0


# ---------------------------------------------------------------- pure helpers

def probe(path: str) -> dict:
    """Width, height and duration via the bundled ffprobe. No Google libraries needed."""
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out = subprocess.run(
        [ff, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    w = h = 0
    dur = 0.0
    for line in out.splitlines():
        if "Stream #" in line and "Video:" in line:
            for tok in line.split(","):
                tok = tok.strip().split(" ")[0]
                if "x" in tok and tok.replace("x", "").isdigit():
                    a, b = tok.split("x")
                    w, h = int(a), int(b)
                    break
        if "Duration:" in line:
            t = line.split("Duration:")[1].split(",")[0].strip()
            hh, mm, ss = t.split(":")
            dur = int(hh) * 3600 + int(mm) * 60 + float(ss)
    return {"w": w, "h": h, "duration": dur}


def shorts_problems(meta: dict) -> list[str]:
    """Why this file would NOT be treated as a Short. Empty list means it should be.

    Worth checking before the upload rather than after: there is no error and no flag — a
    landscape file simply lands on the channel as a normal video, and the only way to notice
    is to look.
    """
    bad = []
    if not meta["w"] or not meta["h"]:
        bad.append("could not read the video dimensions")
        return bad
    if meta["h"] < meta["w"]:
        bad.append(f"landscape {meta['w']}x{meta['h']} — a Short must be vertical or square")
    if meta["duration"] > SHORTS_MAX_SECONDS:
        bad.append(f"{meta['duration']:.1f}s — over the {SHORTS_MAX_SECONDS:.0f}s ceiling "
                   "this tool holds to")
    return bad


def clip(text: str, limit: int) -> str:
    """Collapse whitespace and truncate. For titles — it destroys line breaks."""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def clip_body(text: str, limit: int) -> str:
    """Truncate a description while KEEPING line breaks.

    Descriptions must not go through clip(): YouTube only renders chapter markers when the
    timestamps are on their own lines, so collapsing whitespace silently turns a chaptered
    video into one with none. Caught by test_chapters_go_at_the_top_of_the_description.
    """
    lines = [" ".join(ln.split()) for ln in text.splitlines()]
    out = "\n".join(lines).strip("\n")
    return out if len(out) <= limit else out[: limit - 1].rstrip() + "…"


OUTCOME_WORD = {
    "6": "six", "6nb": "six off a no-ball",
    "4": "four", "4nb": "four off a no-ball",
    "W": "wicket",
}


def reel_metadata(moment: dict, match: str | None = None) -> dict:
    """Title, description and tags for one moment, from the ?data=1 payload.

    The payload already carries striker, bowler, score and outcome for every ball, so a reel
    can be captioned without anyone typing anything. That is most of what the data code was
    for.
    """
    striker = (moment.get("striker") or "").title() or "Unknown"
    bowler = (moment.get("bowler") or "").title() or "Unknown"
    types = moment.get("types") or []
    anchor = moment.get("anchor") or (types[0] if types else "moment")
    word = OUTCOME_WORD.get(str(moment.get("outcome")), anchor)

    if anchor == "wicket":
        head = f"WICKET: {striker} b {bowler}"
    else:
        head = f"{striker} — {word} off {bowler}"

    extra = [t for t in types if t not in ("four", "six", "wicket")]
    if extra:
        head += " (" + ", ".join(extra) + ")"

    score = moment.get("score")
    title = head + (f" · {score}" if score else "")
    if match:
        title += f" | {match}"

    lines = [head]
    if score:
        lines.append(f"Score: {score}")
    if moment.get("strikerScore"):
        lines.append(f"{striker}: {moment['strikerScore']}")
    if moment.get("ball") is not None:
        inns = moment.get("innings", 1)
        lines.append(f"Innings {inns}, ball {moment['ball']}")
    if match:
        lines.append("")
        lines.append(match)
    lines.append("")
    lines.append("Scorecard overlay: https://score.abhinav.dev")

    tags = ["cricket", "highlights"]
    for t in types:
        tags.append({"four": "four", "six": "six", "wicket": "wicket",
                     "milestone": "fifty", "partnership": "partnership"}.get(t, t))

    return {"title": clip(title, TITLE_MAX),
            "description": clip_body("\n".join(lines), DESC_MAX),
            "tags": tags}


def video_metadata(match: str, chapters: str | None = None) -> dict:
    """Title and description for the full highlights video.

    If cut.py's chapter file is passed, it goes at the top of the description. YouTube turns
    those into chapter markers, but only when the first stamp is 00:00 and there are at least
    three of them — cut.py already writes "00:00 Start" first, so that holds.
    """
    lines = []
    if chapters:
        stamps = [ln for ln in chapters.splitlines() if ln.strip()]
        if len(stamps) >= 3 and stamps[0].startswith("00:00"):
            lines += stamps + [""]
        else:
            print(f"  note: {len(stamps)} chapter(s) and first is "
                  f"{stamps[0].split()[0] if stamps else 'none'!r} — YouTube needs 3+ starting "
                  "at 00:00, so they are included as plain text only")
            lines += stamps + [""]
    lines.append("Full highlights, cut automatically from the match recording.")
    lines.append("")
    lines.append("Scorecard overlay: https://score.abhinav.dev")
    return {"title": clip(f"{match} | Highlights", TITLE_MAX),
            "description": clip_body("\n".join(lines), DESC_MAX),
            "tags": ["cricket", "highlights", "full match"]}


# ---------------------------------------------------------------- auth + upload

def _user() -> str:
    u = os.environ.get("USER") or os.environ.get("LOGNAME")
    if not u:
        raise SystemExit("cannot determine $USER for the Keychain lookup")
    return u


def keychain_read(service: str) -> str | None:
    """Read a secret. The value arrives on stdout, which is safe; it is never logged."""
    r = subprocess.run(
        ["security", "find-generic-password", "-a", _user(), "-s", service, "-w"],
        capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def keychain_write(service: str, value: str) -> None:
    """Store a secret, avoiding both of the ways this silently goes wrong on macOS.

    Adapted from the homelab repo's keychain-add.sh, which exists because:
      · `security add-generic-password -w` with no value uses an interactive prompt that
        SILENTLY TRUNCATES AT 128 CHARACTERS. The Keychain stores long values fine — the
        prompt is the limit — and a short write is invisible until the API returns a clean
        401. An OAuth token blob is far longer than 128.
      · Passing `-w <value>` puts the secret in argv, where `ps` can read it, and Jamf
        agents run as root on this Mac.
    Feeding the command to `security -i` over stdin avoids both.

    🛑 One difference from that script, and the reason this does not just shell out to it:
    it wraps the value in "%s", which is fine for a JWT but NOT for JSON — a credentials
    blob is full of double quotes and would break the quoting. Everything here is base64
    encoded first, so the stored value is always quote-free.
    """
    blob = base64.b64encode(value.encode()).decode()
    cmd = f'add-generic-password -U -a "{_user()}" -s "{service}" -w "{blob}"\n'
    subprocess.run(["security", "-i"], input=cmd, text=True, check=True,
                   capture_output=True)
    # Read back and compare exactly, not just by length — a truncated write is otherwise
    # invisible until an upload fails with something that looks like a bad credential.
    if keychain_read(service) != blob:
        raise SystemExit(f"Keychain write to '{service}' did not read back intact — "
                         "do not use it")


def keychain_read_json(service: str) -> dict | None:
    blob = keychain_read(service)
    if not blob:
        return None
    try:
        return json.loads(base64.b64decode(blob).decode())
    except Exception as e:
        raise SystemExit(f"'{service}' in the Keychain is not valid base64 JSON ({e}); "
                         "re-import it")


def client_config() -> dict:
    """The OAuth client, from the Keychain."""
    cfg = keychain_read_json(KC_CLIENT)
    if cfg:
        return cfg
    raise SystemExit(
        f"no OAuth client in the Keychain under '{KC_CLIENT}'.\n"
        "  1. Google Cloud Console -> APIs & Services -> Credentials\n"
        "     -> Create OAuth client -> Desktop app -> download the JSON\n"
        "  2. python publish.py --import-client <downloaded.json>\n"
        "  3. Set the consent screen to 'In Production', or the token dies every 7 days.")


def credentials():
    """Load the stored token, refreshing it, or run the one-time browser consent.

    ⚠ If the OAuth consent screen is left in "Testing", Google expires the refresh token
    after exactly 7 days and an unattended uploader dies once a week for no visible reason.
    Set the consent screen to "In Production" in Google Cloud Console; youtube.upload is a
    *sensitive* scope, not restricted, so a personal app just clicks through an
    unverified-app warning once.
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    info = keychain_read_json(KC_TOKEN)
    if info:
        creds = Credentials.from_authorized_user_info(info, SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            keychain_write(KC_TOKEN, creds.to_json())
            return creds
        except Exception as e:
            print(f"  token refresh failed ({e}); re-running consent")
            print("  if this happens weekly, the consent screen is still in Testing mode")

    flow = InstalledAppFlow.from_client_config(client_config(), SCOPES)
    creds = flow.run_local_server(port=0)
    keychain_write(KC_TOKEN, creds.to_json())
    print(f"  token stored in the Keychain as '{KC_TOKEN}'")
    return creds


def import_client(path: str) -> None:
    """Move the OAuth client JSON Google hands you into the Keychain, then offer to delete it."""
    p = Path(path)
    if not p.exists():
        raise SystemExit(f"no such file: {path}")
    cfg = json.loads(p.read_text())
    if not any(k in cfg for k in ("installed", "web")):
        raise SystemExit("that does not look like an OAuth client JSON "
                         "(expected an 'installed' or 'web' key)")
    if "web" in cfg:
        print("  ⚠ this is a 'web' client; a Desktop app client is what the local consent "
              "flow expects")
    keychain_write(KC_CLIENT, json.dumps(cfg))
    print(f"  stored in the Keychain as '{KC_CLIENT}' and read back intact")
    print(f"  🛑 now delete the downloaded file: rm {p}")


def upload(path: str, meta: dict, privacy: str) -> str:
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    yt = build("youtube", "v3", credentials=credentials(), cache_discovery=False)
    body = {
        "snippet": {"title": meta["title"], "description": meta["description"],
                    "tags": meta["tags"], "categoryId": "17"},   # 17 = Sports
        "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False},
    }
    media = MediaFileUpload(path, chunksize=8 * 1024 * 1024, resumable=True,
                            mimetype="video/mp4")
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)

    resp = None
    while resp is None:
        status, resp = req.next_chunk()
        if status:
            print(f"\r  uploading {status.progress() * 100:5.1f}%", end="", flush=True)
    print(f"\r  uploading 100.0%")
    return resp["id"]


# ---------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", nargs="?")
    ap.add_argument("--import-client", metavar="JSON",
                    help="store the downloaded OAuth client JSON in the Keychain and exit")
    ap.add_argument("-t", "--target", choices=["shorts", "video"])
    ap.add_argument("--match", help='e.g. "Topguns vs Bazzigarz — 2026 FTP20 Div-A"')
    ap.add_argument("--moments", help="events.json from qrscan.py, for reel captions")
    ap.add_argument("--moment", type=int, default=0, help="which moment this clip is")
    ap.add_argument("--chapters", help="the chapter file cut.py wrote, for a full video")
    ap.add_argument("--title", help="override the generated title")
    ap.add_argument("--privacy", choices=["private", "unlisted", "public"], default="private",
                    help="default private — review it on the channel before making it public")
    ap.add_argument("--confirm", action="store_true",
                    help="actually upload; without this the tool only prints the plan")
    ap.add_argument("--force", action="store_true",
                    help="upload as a Short even if the file would not qualify")
    a = ap.parse_args()

    if a.import_client:
        import_client(a.import_client)
        return
    if not a.file:
        ap.error("a video file is required (or use --import-client)")
    if not os.path.exists(a.file):
        raise SystemExit(f"no such file: {a.file}")
    if not a.target:
        ap.error("--target shorts|video is required")
    m = probe(a.file)
    size = os.path.getsize(a.file) / 1e6
    print(f"{a.file}\n  {m['w']}x{m['h']}, {m['duration']:.1f}s, {size:.1f} MB")

    if a.target == "shorts":
        bad = shorts_problems(m)
        if bad:
            print("\n  ⚠ this will NOT be treated as a Short:")
            for b in bad:
                print(f"      - {b}")
            print("      YouTube gives no error for this — it just lands as a normal video.")
            if not a.force:
                raise SystemExit("\n  refusing; re-run with --force to upload it anyway")
        else:
            print(f"  ✓ vertical and under {SHORTS_MAX_SECONDS:.0f}s — will be a Short")

    if a.target == "shorts":
        moment = {}
        if a.moments:
            doc = json.load(open(a.moments))
            ms = doc.get("moments") or doc.get("events") or []
            if not ms:
                raise SystemExit(f"no moments in {a.moments}")
            if a.moment >= len(ms):
                raise SystemExit(f"--moment {a.moment} but only {len(ms)} exist")
            moment = ms[a.moment]
        meta = reel_metadata(moment, a.match)
    else:
        if not a.match:
            raise SystemExit("--match is required for a full video (it becomes the title)")
        chapters = Path(a.chapters).read_text() if a.chapters else None
        meta = video_metadata(a.match, chapters)

    if a.title:
        meta["title"] = clip(a.title, TITLE_MAX)

    print(f"\n  title       {meta['title']}")
    print(f"  tags        {', '.join(meta['tags'])}")
    print(f"  privacy     {a.privacy}")
    print("  description")
    for line in meta["description"].splitlines():
        print(f"    | {line}")

    if not a.confirm:
        print("\n  DRY RUN — nothing uploaded. Re-run with --confirm to publish.")
        return

    print()
    vid = upload(a.file, meta, a.privacy)
    kind = "shorts" if a.target == "shorts" else "watch?v="
    print(f"\n  uploaded: https://youtube.com/{kind}{vid}" if a.target == "shorts"
          else f"\n  uploaded: https://youtube.com/watch?v={vid}")
    if a.privacy == "private":
        print("  it is PRIVATE — watch it, then make it public in YouTube Studio.")


if __name__ == "__main__":
    main()
