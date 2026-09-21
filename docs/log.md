# Update Log

## 2026-09-21

### Knowledge moved into an OKF v0.2 bundle

`docs/` is now an Open Knowledge Format bundle — `okf-base.yaml` at the root, index at
`docs/index.md`, validated with `okflint validate --manifest okf-base.yaml`. Same shape as the
homelab repo.

The reasoning was spread across four files that each had a different job. `README.md` is the
public usage guide and had accumulated traps and rationale; `architecture.md` was almost entirely
knowledge; `CLAUDE.md` mixed ground rules with domain detail; `highlights/README.md` had become a
200-line design document sitting inside a tool directory.

Converted into six concepts: `overlay.md`, `data-code.md`, `highlights.md`, `analytics.md`,
`deployment.md`, `feature-ideas.md`. `architecture.md` was **absorbed and deleted** — its
project-structure tree and data-flow diagram are the parts worth keeping and they moved into
`overlay.md`. `feature-ideas.md` moved from the root into the bundle. `CLAUDE.md` is now ground
rules, an address index and one-line tripwires only.

Two things the conversion surfaced, both stale claims that had been sitting in `README.md`:

- It told people to point OBS at a "deployed GitHub Pages URL". GitHub Pages was dropped in
  PR #9 in favour of Netlify.
- It said pushes to `main` touching `worker/**` deploy automatically "once a
  `CLOUDFLARE_API_TOKEN` repository secret exists", stated as a fact. The workflow does exist but
  skips itself, and **not adding that secret is a deliberate decision** — the opposite of what a
  reader would have concluded.

`CLAUDE.md` also pointed at `docs/cricclubs-api.md`, which exists only on the
`feature/cricclubs-views` branch. The index links it and flags it as arriving with PR 13; OKF
permits broken links, since they mark knowledge not yet written rather than an error.

### The `?data=1` machine-readable code shipped

The overlay now draws a QR code carrying the whole bar state, so `highlights/` reads events
instead of inferring them from card colours. `?data=1`, off by default.

Sized down from 148 px to **66 px** over the day by measuring rather than assuming: the quiet
zone from 4 modules to 2, and the module from 4 px to 2 px. Both floors were then confirmed by
pushing past them — a 0-module quiet zone fails outright, and 1 px modules manage one good frame
in twelve because the compositing upscale leaves them with no unblended centre.

Verified on two real IRL Pro captures from the match rig: **55 of 55** sampled frames byte-exact
with the CRC passing, on both the 148 px and the 66 px geometry, at 14.96 and 13.89 Mb/s.

### Four harness faults, and what they cost

Every QR measurement taken before these were found had been wrong, in both directions:

- `cv2.QRCodeDetector` was scoring **detection** as **decoding**. It returns a str and mangles
  arbitrary bytes — 0 of 60 random payloads recovered byte-exactly from *perfect* images, while
  reporting success every time. zxing-cpp recovers 60 of 60 and is now pinned with that reasoning
  in `requirements.txt`, because the next person will reach for cv2.
- The Python `qrcode` library inflates binary payloads: 42 random bytes became a **v14** code,
  73 modules instead of 29. Benches must use the same npm encoder the overlay ships.
- An early bench held the code still for a whole clip, so h264 propagated it losslessly from the
  I-frame and everything passed.
- 2-level mode had inverted polarity, which looked like a codec failure rather than a bug.

The pattern is the lesson: each fault was found by deliberately pushing until something broke,
never by reading a green result. Recorded in `highlights.md` §7b.

### The audio data channel was tested and ruled out

An audio channel would have beaten pixels outright — nothing to crop, and SMPTE LTC already
standardises data on an audio track with 32 free user bits per frame. Measured crosstalk through
the recording's own AAC-LC at 95 kbit/s was only +0.3 dB, so a data channel would have been
cleanly strippable.

It needed one thing to be true, and it isn't: **IRL Pro does not capture browser-source audio.**
A probe page emitting 1000 Hz left, 3000 Hz right and a 220 Hz tick, recorded on the real rig,
showed the phone playing the tone through its loudspeaker and the microphone hearing it — 59 ms
reverb tail against the 8 ms envelope it was generated with, channel separation collapsed to
4 dB at 3 kHz, and mic AGC ducking the broadband level 25 dB when the tone began. Corroborated by
Softvelum staff on the WebView component: *"The corresponding component does not provide audio
source for our app."*

So LTC, ggwave and every other modem are moot regardless of merit. The same recording confirmed
what mattered: browser-source **video** composites correctly.

### A boundary off a no-ball was invisible

A six off a no-ball arrives as `7nb`, not `6`, and `detectEvents()` exact-matched `'4'` and
`'6'` — so no card fired, the disc was coloured as a plain no-ball, and the shot never reached a
reel. `runsOffBat()` now parses runs off the bat, accepting both scoring conventions since
scorers differ on whether they include the penalty.

The same trap reappeared in a different disguise in the QR event rules: `ballsBowled` counts
legal balls, so a no-ball does not advance it and a new delivery has to be recognised from the
runs or the wickets instead.

### `strip.py` abandoned and deleted

Reading the overlay's ball-by-ball strip directly would have removed the dependency on catching
a 2-second card. It cannot work: the strip's x position moves across the match, so a single
calibration is wrong by construction, and light discs are nearly invisible against the card. The
disc finder itself was correct; the grid assumption was what failed. The QR code solved the
underlying problem properly. Kept in `highlights.md` §8 so it is not attempted again.
