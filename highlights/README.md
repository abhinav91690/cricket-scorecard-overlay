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

## Tests

```sh
.venv/bin/python test_payload.py    # the cross-language wire-format contract
.venv/bin/python test_qrscan.py     # the event rules — pure, no video needed
```

Both also run under `pytest`.

## Files

| | |
|---|---|
| `qrscan.py` | reads the `?data=1` code and derives events from payload changes |
| `detect.py` | fallback: finds event cards by accent-stripe colour |
| `cut.py` | cuts and concatenates clips, writes a chapter list |
| `payload.py` | the wire format, Python side |
| `requirements.txt` | 🛑 zxing-cpp, **not** OpenCV — the comment explains why |
