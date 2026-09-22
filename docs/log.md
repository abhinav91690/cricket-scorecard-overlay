# Update Log

## 2026-09-21

### 🛑 The upload lock was never real here, and I never tested it

`publish.py --privacy public --confirm` uploaded through this project's **own unverified** OAuth
client. The video landed **Public**, played in a signed-out incognito window, and its visibility
could still be changed. A locked video fails all three. Recorded in
[publishing.md](./publishing.md) §0.

**The premise most of this session was built on was an untested assumption.** Google does
document that unverified projects get their uploads locked private — that part is real — but the
earlier attempt died at the OAuth consent wall (§3a) before any upload completed, and I wrote the
restriction up as a settled 🛑 tripwire anyway. Everything downstream followed from it:

- a Make.com account, a scenario, a webhook and a Keychain entry pair
- a costed Cloudflare R2 hosting plan, to get past a 5 MB limit
- a recommendation to apply for Google's compliance audit
- two wrong claims about that 5 MB limit, corrected separately the same evening

None of it was needed. The measurement was ten minutes and one throwaway clip, and it should have
come before the tripwire, not after the workaround. `--metadata-only` stays as the fallback, but
it is no longer the useful mode.

⚠ **The Make result is weaker than I presented it.** It was framed as proof that an audited
project escapes the lock. With the direct API behaving identically, that experiment had no
control: the outcome is equally consistent with "the lock does not bite here at all". §5 now says
so, and the route is demoted to a fallback.

### 🛑 httplib2 ignores the system trust store and both CA environment variables

The test was blocked first by TLS, not by YouTube. `googleapiclient` talks through **httplib2**,
which uses the bundle inside `certifi` and reads neither `SSL_CERT_FILE` nor
`REQUESTS_CA_BUNDLE` — so behind Zscaler every API call failed with "unable to get local issuer
certificate" **after** the OAuth consent had succeeded and written a token, because that leg goes
through `requests`, which does honour `REQUESTS_CA_BUNDLE`.

A valid credential plus a failing transport reads exactly like a bad credential. `ca_bundle()`
and `authorized_http()` now hand the bundle to httplib2 explicitly. This is a *different* fault
from the `VERIFY_X509_STRICT` one already recorded — same proxy, unrelated fixes, distinguishable
only by the error text. [publishing.md](./publishing.md) §4b.

Also fixed while there: the success line printed
`https://youtube.com/shortsMO3YZtBHz1c` — a missing slash — and followed it with a 🛑 warning
that the video was probably locked, which was both wrong and alarming.


### The locked-private blocker is solved: upload through Make's audited project

`publish.py --post-to` posts a clip and its captions to a Make.com custom webhook, which feeds
`YouTube › Upload a Video`. Tested end to end: the video landed **Public**, as a Short, with an
**empty Notices panel** in Studio — so the §0 lock, which attaches to the calling API project
rather than to the channel, does not apply to this route. Recorded in
[publishing.md](./publishing.md) §5.

This matters because §0 had made the uploader mostly pointless: our own unverified project can
only produce videos YouTube locks private and will not unlock on appeal. `--metadata-only` was
the honest fallback. It no longer has to be.

Two things the test corrected about my own work:

- ⚠ **`--post-to` returned before the `--confirm` gate**, so it uploaded with no confirmation —
  breaking the one invariant §1 states outright ("nothing uploads without `--confirm`"). The
  safety default existed and the new code path simply walked around it. Now gated.
- ⚠ **`--privacy` is not honoured on this route** and nothing said so. The Make module sets
  Privacy Status statically, so the POSTed field is ignored; the dry-run output printed
  `privacy private` next to an upload that would land public. It now warns on every run.

And one measurement trap worth keeping: **`oembed` answered 401 throughout, for both URL forms,
while the video loaded fine in a signed-out incognito window.** Read on its own that looks
exactly like a locked video, and I nearly wrote it up first as the lock and then as propagation
lag. It was neither — oEmbed just does not resolve fresh Shorts. The controls (known-public →
200, nonexistent id → 400) proved the instrument ran; they could not tell me it was the wrong
instrument. A signed-out page load is what settled it. Fifth entry in the same family as the
four harness faults in [highlights.md](./highlights.md) §7b.

⚠ **The 5 MB ceiling is worse than first recorded, and the workaround I proposed was wrong.**
It is not a webhook limit and it is not "every tier": it is a **plan-level cap on any file a
scenario handles**, 5 MB only on the free plan, rising to Core 100 MB / Pro 250 MB / Teams
500 MB / Enterprise 1 GB. So hosting a reel on R2 and having Make fetch it by URL hits the same
wall — the R2 work I had queued as "the remaining step" would not have helped. A ~20 MB reel
needs the **Core** tier. The test clip was 0.68 MB, which is why nothing surfaced this.


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
