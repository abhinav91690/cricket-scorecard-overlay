# highlights

Turns a match recording into reels, locally. No cloud, no upload, no API keys.

> **This is a usage card.** The reasoning — why the QR path replaced stripe detection, the event
> rules and the cricket that shapes them, the clip windows, and the harness faults that made
> earlier measurements lie — lives in **[`../docs/highlights.md`](../docs/highlights.md)** and
> **[`../docs/data-code.md`](../docs/data-code.md)**. Read those before changing anything here.

## Setup

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

ffmpeg ships inside `imageio-ffmpeg`; nothing needs installing system-wide.

## Use

```sh
# preferred: the stream was opened with ?data=1
.venv/bin/python qrscan.py "/path/match.mp4" -o events.json

# fallback: no data code in the recording
.venv/bin/python detect.py "/path/match.mp4" -o events.json

# either way, cutting is the same
.venv/bin/python cut.py "/path/match.mp4" events.json -o reel.mp4
.venv/bin/python cut.py "/path/match.mp4" events.json -o wickets.mp4 -t wicket
```

Both scanners emit the same `moments` shape, so `cut.py` never needs to know which one ran.
`qrscan.py` prints a message and writes nothing if it finds no code, rather than producing an
empty reel.

## Per-player reels

```sh
# 1. narrow this match's crop on a still — the camera framing changes every match
.venv/bin/python crop.py "/path/match.mp4" -t 3800 -o crops.png

# 2. cut one reel per player per role. Pass a LIST to get one file per shape and
#    pick after watching them; omit a flag to leave that role at full frame.
.venv/bin/python reels.py "/path/match.mp4" events.json -o reels/ \
    --batting-innings 1 --team Topguns --match "Topguns vs Bazzigarz" \
    --aspect-bat 4:5,1:1 --aspect-bowl 1:1
```

🛑 Pass the wrong `--batting-innings` and every attribution inverts — it cannot be guessed.

🛑 **There is no default crop.** The framing changes per match and the two roles want different
boxes: a batting reel must hold **both** sets of stumps (the batter's end alternates every over
and on every odd run), while a bowling reel needs the run-up too. Omitting a flag gives full
frame, which `publish.py` then refuses as a Short rather than quietly uploading a landscape
video. Every crop still removes the `?data=1` block for free. Measurements in
[`../docs/highlights.md`](../docs/highlights.md) §13a.

One player can get two reels — `v-kohli-batting.mp4` and `v-kohli-bowling.mp4`.

## Publish

```sh
# a per-player reel, captioned from the sidecar reels.py wrote
.venv/bin/python publish.py reels/v-kohli-batting.mp4 --target shorts \
    --meta reels/v-kohli-batting.json --privacy public --confirm

# a single-moment reel, captioned from the scan output
.venv/bin/python publish.py reel.mp4 --target shorts \
    --moments events.json --moment 3 --match "Topguns vs Bazzigarz"

# the full highlights video, with cut.py's chapters in the description
.venv/bin/python publish.py highlights.mp4 --target video \
    --match "Topguns vs Bazzigarz" --chapters highlights-chapters.txt
```

Nothing uploads without `--confirm`, and uploads default to **private**.

The direct API path publishes fine — measured, despite docs to the contrary
([`../docs/publishing.md`](../docs/publishing.md) §0). Add `--privacy public` to publish
immediately, and check it signed out.

A Make.com webhook route also exists as a fallback. It works, but it is **not** the first
choice: a third party holds a token for the channel, and files over 5 MB need a paid tier.

```sh
# --post-to with no argument reads the webhook URL from the Keychain
.venv/bin/python publish.py reel.mp4 --target shorts --moment 3 \
    --match "Topguns vs Bazzigarz" --post-to --confirm
```

⚠ Two limits on that route: **5 MB per file on Make's free plan** — a plan-level cap, so
hosting the reel for Make to fetch does *not* help; Core (100 MB) is the cheapest tier that
carries a real reel — and **`--privacy` is ignored** because the Make scenario sets visibility
itself. Setup, the OAuth trap and the full reasoning are in
[`../docs/publishing.md`](../docs/publishing.md) §5.

## Tests

```sh
.venv/bin/python test_payload.py    # the cross-language wire-format contract
.venv/bin/python test_qrscan.py     # the event rules — pure, no video needed
.venv/bin/python test_publish.py    # Shorts validation and caption generation
.venv/bin/python test_reels.py      # 🛑 per-player attribution — fails silently if wrong
```

All four also run under `pytest`.

## Files

| | |
|---|---|
| `qrscan.py` | reads the `?data=1` code and derives events from payload changes |
| `detect.py` | fallback: finds event cards by accent-stripe colour |
| `cut.py` | cuts and concatenates clips, writes a chapter list |
| `payload.py` | the wire format, Python side |
| `reels.py` | per-player, per-role reels for one team, cropped for Shorts |
| `crop.py` | draws the candidate crops on a frame, to pick a match's framing |
| `publish.py` | uploads a reel or the full video to YouTube |
| `requirements.txt` | 🛑 zxing-cpp, **not** OpenCV — the comment explains why |
