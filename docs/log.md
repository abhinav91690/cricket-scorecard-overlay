# Update Log

## 2026-09-26

**Waiting panels show once, and come off when the openers are in.** Watching match 4651 live on
production, the pre-match line-up cycled 16 s on, 4 s off until the first ball. It is 1240×553 px,
about a third of a 1080p frame, from 35% to 87% of the way down, over the pitch. Now each waiting
panel shows once per load. The line-up stays up for 60 s or until both openers are picked, the
innings summary for 2 min or until the chasing side's openers are picked, and the result stays up
for good. Also fixed: a team whose name already ends in "XI" was headed "AVV XI XI".

The simulator now leaves the openers blank until two minutes before play (CricClubs does, seen
live), before the first ball and at the break, and its grader checks that each early dismissal
happens once. That caught a real bug: a poll landing during the 300 ms fade dismissed the panel
again and restarted the fade.

## 2026-09-25

### Replay mode plays a whole match, toss to result

`?mode=replay` used to cycle a handful of fixed states. It now plays a complete simulated match —
pre-match line-up, both innings with every event card, the innings-break summary, the result card,
and a super over with `?superover=1` — at `?speed=` (default ×5, about 30 minutes), optionally from
`?start=<phase>`. [overlay.md](./overlay.md) §2a.

It is the simulator from `sim/` running inside the page behind a `Feed`: frames come from the
simulated match and view switches go to it, so the overlay runs its **live** code path unchanged.
That is the point — it is a rehearsal of Saturday, not a demo of it. Verified in a real browser on
the production build: the line-up on air within 2 s, `?data=1` decoding with a valid CRC, the
result card, and a super over with the right batting side and overs.

Three things worth keeping:

- ⚠ **tsc had never type-checked `sim/`.** Node runs it with types stripped and it uses `.ts`
  import paths; importing it from `src/` needed `allowImportingTsExtensions` (legal with `noEmit`).
  It passed clean, and is checked from now on.
- ⚠ **A shared fixture cannot be tree-shaken per importer.** The simulator read team names from
  the 8 kB summary view `mock_view_8`, which the live app never used; once the page imported the
  simulator, that fixture landed in the *main* bundle, +5 kB for every live overlay. Views 2 and 4
  carry the same fields, and the main bundle ended up 1.6 kB smaller than production.
- The speed is capped at ×30 and the replay reads every second, so every simulated ball still gets
  a read of its own.

## 2026-09-24

### ⚠ A fifth over is legal in CricClubs — the simulator no longer forbids it

A correction to the entry below. The simulator's fifth over was reported as a bug, "a T20 caps a
bowler at four", and the fix enforced that cap and failed any run that broke it. But **CricClubs
lets the scorer override the limit and give a fifth over**, and leagues use it, so the simulator was
stricter than the thing it simulates.

The cap is now a preference: the scheduling fix stays (most overs left goes next, which is how a
captain avoids needing an override), and when nobody else is under the limit the least-used bowler
gets an extra over instead of the match stopping. Checked directly: 20 overs from four bowlers gives
five each, spread evenly, never two in a row — the old code would have thrown. The grader's
over-limit check is gone and each report states the busiest bowler and any overrides instead.

The overlay itself never had a limit, and the `?data=1` code has room for 21 overs from one bowler.

### The simulator plays super overs and respects the over limit — and found four bugs

`npm run sim:run -- --super-over [--seed N]` ties the main match by construction and decides it with
a super over; the grader now has 21 checks in that scenario and 18 in the ordinary one.
[overlay.md](./overlay.md) §13.

🛑 **A bowler bowled five overs.** When the recorded quotas ran out, the generator took any bowler
who had not just bowled, with no limit. It now picks whoever has the most overs left and enforces a
fifth of the overs; graded every run.

What the super-over scenario found, all in the first super-over innings:

- 🛑 **The bar named the side not batting** — 6 of 6 samples. `ui.ts` read `isSecondInningsStarted`,
  which the one capture allows to stay the main match's flag through a super over.
- 🛑 **Its wickets went undetected**, and the dismiss-on-score rule and the `?data=1` code read the
  wrong side the same way. The simulator's first super over had no wickets, so the wicket check had
  passed *vacuously*; a seed with wickets in both innings, then the fix reverted, gave 14 cards for 15.
- 🛑 **Overs showed as a ball count** — "3 ov" three balls in, and 18 balls in the data code. That
  one is fact, not assumption: the capture has `t1Overs` "6" for a completed super over.

All four modules now ask `battingSecond()` and `teamOvers()` in `utils.ts`. Tests written first and
seen failing; the two new grader checks were each checked by reverting their fix.

⚠ **Still unverified:** what `isSecondInningsStarted` holds during a live super over. The fix is right
under either reading, but only a live capture would say which is true. And the data code has no
super-over marker, so `highlights/` cannot tell a super-over ball apart
([highlights.md](./highlights.md) §9).

### The overlay reads straight after a view switch, not a whole refresh later

With switches applying in under half a second, waiting the full 5 s refresh before reading a
peeked view was pure cost: CricClubs' own overlay sat on the squad or scorecard view for that whole
time. `switchView()` now resolves when CricClubs answers, and the next poll follows 300 ms later.
Measured on 4631: **1.47 s** on the data view per peek instead of **6.16 s**, about 9 s a match
instead of 37, and the early read still collected the squad. [overlay.md](./overlay.md) §14.

🛑 Coming home is not attempt-limited, so the fast follow-up is capped at `MAX_FAST_POLLS` in a row
before falling back to the old cadence. The test for that was checked by removing the cap.

### ✅ View-switch latency, measured: under half a second

The peek design assumed CricClubs applies a view switch by the next poll, and nobody had checked.
On finished match 4631 (own club, restored to view 1 afterwards) four switches each took effect by
the first read, 0.37–0.41 s after the request — the read's own round trip. `PEEK_ATTEMPTS` × 5 s is
ample and the simulator's instant switch is realistic. [cricclubs-api.md](./cricclubs-api.md) §2.

Deliberately **not** measured on the live match offered for it: it belonged to another league and
was in play, and a switch flips CricClubs' own overlay for everyone watching that match. A
finished match of our own answers the same question with nobody affected. A live match could still
be served differently, so the first real break is worth watching.

## 2026-09-23

### 🛑 One failed view peek blocked the next

`desiredView()` asked for the first missing piece of a phase unconditionally. When a view never
yielded, `steerView()` stopped asking after `PEEK_ATTEMPTS` but never moved on, so the next view
was never requested: a failed team 1 squad meant team 2's was never fetched, and the line-up
showed with **both** XIs empty. The same at the break (view 2 blocked 3) and the end (4 blocked 5).
It now skips views that have used their tries. [overlay.md](./overlay.md) §14.

The fix broke an existing test, `gives up on a view that never yields and shows the panel anyway`,
and the test was the thing that was wrong: it waited six polls for the line-up, which was only
enough *because* team 2's squad was never asked for. It now waits seven and asserts both views
got their three tries. The simulator cannot see any of this — every peek it serves succeeds.

### The result card, rebuilt to a broadcast layout

The match-summary panel now follows a reference result card: the result as the headline over a
rule, a card per side with its score, its two top batters and its best bowler, then an inverted
strip of the match's top performers. Built in the overlay's own tokens, so every theme styles it.
[overlay.md](./overlay.md) §14c.

🛑 **Each card now holds that side's own players.** The previous panel paired a side's batters with
the *opposition* bowler who bowled at them — an innings view that read as if the bowler belonged
to the team named above him. The reference mock-up had the same mix-up in a plainer form, with one
team's players under the other's name. A test fails if either comes back; it was checked by putting
the opposition bowler back and watching it fail.

⚠ **The winner is read from free text, by name or by code.** CricClubs writes both
`"TOPGUNS UNITED won by 5 Wickets"` and, after a tie, `"Match tied. TGN won the super over."`. The
first version of the parser anchored at the start and captured `"Match tied. TGN"` across the full
stop, so no winner was found; the test built from the real 2079 wording caught it.

⚠ **Team codes are cached from the data views, next to the names**, because the scorebar swaps
sides during a super over and would put the wrong badge on each card.

✅ **`manOfTheMatch` is real data**, filled in after a match ends — [cricclubs-api.md](./cricclubs-api.md)
had it listed as empty in practice, which was wrong. It now leads the performers strip.

### 🛑 The simulator leaked a real match's data a second time

The first light-theme run named *Anand Babu B* player of the match on 1-43 — the award from real
match 2079, inherited by `sim/match.ts` through the capture its scorebar is built from, and handed
to whoever that player happened to be in a different, simulated match. Exactly the class of leak
`isSuperOver` was. The sim now publishes its own award, the way CricClubs does: its top scorer,
only once the match has ended.

Two of these is a pattern, so it is now a `CLAUDE.md` tripwire: every field the simulator does not
set explicitly is a value from a real, different match.

### Also

- The stale `setDisplay` line in `overlay.md` §3 is gone; this branch deleted the helper.
- `overlay.md` §14's subsections are back in order (14a, 14b, 14c).
- Both themes screenshotted: `topguns-dark` and `topguns-light`, each 17/17 in the simulator.

## 2026-09-22

### Instagram: the hosting half is built, and §8 rewritten from measurements

R2 bucket `overlay-reels` created (WNAM, Standard — the free tier does not cover Infrequent
Access). `r2creds.py` holds the S3 credentials in the Keychain, clipboard-driven, adapted from
the homelab script. `r2.py` uploads, presigns and deletes with **SigV4 written in stdlib**.

🛑 Hand-rolling request signing is normally wrong. The reason it is defensible here is that
**a signing bug fails loudly** — a wrong signature is a 403, never a wrong-but-accepted
result. That is the inverse of the failure class this repo keeps hitting. boto3 was rejected
on three grounds: ~50 MB of botocore for three operations, a `requirements.txt` that justifies
every line, and a venv in the main checkout that other sessions share.

⚠ **The selftest was checked for the ways it could pass for free**, not just run. The decisive
probe: an unsigned GET of the object returns **HTTP 400**, so the bucket is not public — which
is what makes a successful presigned GET evidence of anything. With a public bucket the test
would pass with a completely broken signer. Wrong secret → 403, wrong key id → 401, presign
expired 2 s ago → 403, tampered key → 403.

Real-size round trip, 16.7 MB: PUT 2.1 s, presigned GET 0.8 s byte-exact, `video/mp4`, exact
length, DELETE 204. **Range request → 206**, which had to work because Meta probes with
partial requests before pulling the file.

### Corrections to what §8 previously claimed

- **"Sources disagree on whether Creator works or it must be Business"** — they don't. Both
  work; only Personal accounts are excluded. The club account is already Professional.
- **A Facebook Page is not required.** Meta has two configurations and only *Facebook Login
  for Business* needs a linked Page. **Instagram API with Instagram Login** supports content
  publishing with no Page, scope `instagram_business_content_publish`.
- The app must be created as type **Business** — the docs state a non-Business app has to be
  recreated, so choosing wrong costs a rebuild.

### 🛑 Two new tripwires

- **A long-lived Instagram token dies at 60 days and then cannot be refreshed at all.** Using
  it does not extend it; only an explicit `refresh_access_token` call does. The off-season is
  the hazard — a gap over 60 days kills it silently and costs the whole app flow again, where
  YouTube's equivalent trap only costs a browser round trip.
- **Instagram has no private-first option.** The YouTube model of upload-private-then-flip has
  no equivalent, so `--confirm` is load-bearing and publishing stays manual-trigger only.

### 🛑 A live super over was being shown as an innings break

`matchPhase()` read the scorebar's overs and balls, and the scorebar **swaps to the super-over
sides and totals**, so the gap between the two super-over innings was indistinguishable from an
innings break. The overlay put the **main match's** first innings on air, labelled "1st innings",
while a super over was being bowled. It now returns `play` while `isSuperOver` is set, below the
`isMatchEnded` check so a finished super over still gets its match summary.
[overlay.md](./overlay.md) §14b.

⚠ **`isSuperOver` and `isSuperOverSecondInningsStarted` were typed in `types.ts` and read
nowhere.** The flag that disambiguates this existed in the payload the whole time.

⚠ **No fixture could have caught it.** Match 2079 — the source of every fixture in
`mockData.ts` — *is* a super-over tie, but it was captured after the match ended, so
`isMatchEnded` is `'1'` and the real frame short-circuits to `ended`. The test winds that capture
back to mid-super-over, and was checked by running it before the fix: `expected 'break' to be
'play'`.

### 🛑 The simulator was claiming a super over on every frame of a normal match

Fixing the above immediately broke **6 of the simulator's 17 checks** — no line-up panel, no
innings summary, no pre-match or break peeks. The cause was in `sim/match.ts`, not in the fix:
`const base = v(mock_view_1)` inherits the real 2079 capture, which carries
`isSuperOver: "true"` for the whole match, and the overrides never reset it. Every simulated
frame was asserting a live super over.

The intent had always been otherwise — `isSuperOver: false` was being set on the returned data
object, but **not inside `values`**, which is where the overlay reads it. One line, in the right
place, and all 17 checks pass again.

🛑 **A fixture built from a real match inherits that match's quirks.** This one sat inert because
nothing read the flag; the moment something did, it silently disabled two whole phases of the
harness. Worth remembering for any fixture derived from a live capture.

### `stripPii()` walks the payload instead of trusting a key list

It deleted `email` from six hardcoded keys — correct for every view in
[cricclubs-api.md](./cricclubs-api.md) §3, but a new CricClubs view with a new row-bearing key
would have leaked emails **silently onto a public broadcast**, and nobody would notice until
someone paused the stream. It now walks the whole object, with a `WeakSet` so a cyclic payload
cannot hang the poll loop. Verified the leak test fails first.


### Merged `main` into the views branch (PR 13)

`main` had moved 26 commits ahead while this branch sat open, including the OKF conversion that
**deleted `architecture.md` and the root `feature-ideas.md`** — both of which this branch had
edited. Nine conflicts, resolved rather than discarded:

| File | Resolution |
|---|---|
| `src/utils.ts`, `src/events.ts` | additive on both sides — `panel` param beside `data`, `wicketFallText` beside `runsOffBat` |
| `src/cards.ts` | kept this branch's panel types and `fow`, grafted on `main`'s `four`/`six` aliases |
| `src/app.ts` | combined the view/panel machinery with the `?data=1` code (see below) |
| `CLAUDE.md` | took `main`'s tripwire structure; re-added the `sim` commands and two new tripwires |
| `README.md` | `main`'s structure, keeping this branch's user-facing panel documentation |
| `.gitignore` | additive |
| `architecture.md`, root `feature-ideas.md` | took the deletion, **after porting this branch's edits** into `docs/overlay.md` (§11 tree, §13 simulator, new §14) and `docs/feature-ideas.md` (idea 11) |

🛑 **The one resolution that was a real decision, not a mechanical merge:** `setDataCode()` now
sits *below* the `isFullFrame()` guard in `renderFrame()`. A view peek carries no live fields, so
encoding one would hand `highlights/` a **CRC-valid payload of nonsense** — the CRC cannot catch
it, because the bytes are honestly what we encoded. Naive conflict resolution would have put the
call where `main` had it, above the guard, and nothing would have looked wrong.

⚠ Pinned by `never encodes a view peek into the ?data=1 code` in `app.test.ts`, and the test was
checked by bypassing the guard: it reports "expected 1 times, but got 2 times". A test for this
that cannot fail would be worse than none.

`docs/cricclubs-api.md` arrived from this branch predating the bundle, so it gained OKF
frontmatter, and the "arrives with PR 13" caveats in `docs/index.md` and `CLAUDE.md` are gone.

✅ Verified after the merge: `npm run build` clean (197 tests), `okflint` conformant, and
`npm run sim:run` played a full simulated match with **all 17 checks passing** — peeks only while
idle and never repeated, panels waiting for their peeks, every card timed, all 62 dismissals
explained by a score change. That harness guards exactly the files this merge touched.

## 2026-09-21

### The reel crop is left open — no default shape at all

`--aspect-bat` and `--aspect-bowl` now have **no defaults**. Omit a role's flag and that role is
cut at full frame, which `publish.py` correctly refuses as a Short instead of letting a
landscape file land as an ordinary video. Pass a comma list and one file per shape is cut, each
with its own caption sidecar, so several can be compared on screen and `--meta` still pairs with
whichever survives review. [highlights.md](./highlights.md) §13a.

Two reasons the shape cannot be a constant, and picking one would have been a false economy:
the camera framing changes every match and nothing in the file reveals where the pitch sits,
and the two roles need different boxes anyway — a batting crop must hold **both** sets of stumps
because the batter's end alternates, while a bowling crop needs the run-up behind them.

The measured spans for the reference camera stay in the docs, but as a measurement of *that*
camera rather than as a recommendation; `crop.py` re-derives them per match.


### The reel crop is a per-match input, and the two roles crop differently

The camera framing changes every match, so the crop cannot be a constant — and batting and
bowling do not want the same box anyway:

| Reel | Must contain | Default |
|---|---|---|
| **batting** | **both** sets of stumps — 🛑 the batter's end alternates every over and on every odd run, so one end loses half their shots. The run-up is irrelevant. | `4:5` |
| **bowling** | the stumps **and the run-up**, which starts behind them | `1:1` |

`--aspect-bat`, `--aspect-bowl`, `--crop-x-bat`, `--crop-x-bowl` set them independently, and new
`crop.py` draws the candidates on a real frame with their spans printed, so a match's values can
be read off the picture in a minute. [highlights.md](./highlights.md) §13a.

### 🛑 One player, two roles, two reels — an all-rounder was getting one broken reel

Reels are now keyed by **(player, role)** with the role in the filename. Keyed by name alone, a
player who hit a four and later took a wicket got a single reel holding both, and every caption
helper reads the role off the first moment — so it would have been captioned with batting
figures while containing a wicket. It also made a per-role crop impossible to apply.

⚠ **Nothing in the fixture could have caught this**: it has one innings and two events sharing a
striker and a bowler, so no player ever appears in both roles. It was found by asking what the
per-role crop should do for a player who does both, not by a failing test. Now pinned by
`test_an_all_rounder_gets_one_reel_per_role`.


### 🛑 Reels crop square, not 9:16 — the old crop cut the pitch in half

`--vertical` produced a 9:16 centre column. On this camera that is **geometrically incapable**
of holding the action: the camera is side-on, the pitch runs across the frame occupying about
36%–73% of the width, and a 9:16 window at 16:9 is only **31.6%** wide. Checked against three
real events in the reference match, it cut off the bowler's end every time — including the
batter at the far stumps on the wicket. A 1:1 crop is 56.2% wide and holds the whole pitch.
[highlights.md](./highlights.md) §13a.

🛑 **The old value was never a decision.** It was ffmpeg's `crop` centring default, and the
justification written in these docs — that it removes the `?data=1` block — is a side effect of
*any* crop starting past ~4% of the width, not a reason to pick that shape. I documented a
coincidence as a rationale, and it stood until someone asked how the crop was chosen.

❌ **Motion-based auto-crop was tried and rejected.** A per-column temporal standard-deviation
map per clip, the same technique `find_bar()` uses to locate the overlay, put the peak at 81.6%,
39.2% and 75.8% on the three events. Those are not the batter: across a 20-second window the
bowler's run-up and the fielders chasing outweigh a shot lasting a fraction of a second. It
found the bowler's end on one clip and the striker's on another — not consistently wrong, just
uninformative. Recorded as a negative result so it is not re-attempted.

⚠ There is no fixed action side to aim at anyway: the striker's end alternates every over and
again on every odd run. Square sidesteps the question rather than answering it per ball.

Shorts accept height ≥ width, so square still uploads as a Short — confirmed through
`shorts_problems()` and a real 1080x1080 encode. `--aspect` and `--crop-x` remain for a
different camera setup.


### Captions read like a scorecard line

`reels.py` captions were `V. Kohli — 1 six`, which used almost nothing the payload carries.
They now read as cricket: `V. Kohli 46 (28) — 2 sixes, 1 four`, or `J. Bumrah 3/24 (4.0 ov)`
for a bowling reel, with a stamped commentary line per ball giving the over and the score.
[highlights.md](./highlights.md) §13c.

Four decisions in there worth keeping:

- `figures()` reads the player's **highest** figures across every state, not the ones on their
  last boundary. ⚠ Otherwise a batter whose final four came at 20 but who finished on 60 is
  captioned "20".
- 🛑 **The headline is the innings; "In this reel" is what was captured.** They differ whenever
  the stream started late, so both are named rather than leaving one looking wrong.
- ⚠ Zero counts are omitted — the first real run produced `1x4, 0x6`, which reads like a bug.
- ⚠ A bowling title drops its wicket count only when it equals the innings figure; a smaller
  number means the reel holds part of the spell, which is worth saying.

Two of those were only visible by running it on the real recording rather than on the unit
tests, which is why the fixture output is checked by eye as well as asserted.

### Pre-match checklist

[highlights.md](./highlights.md) §14. The pipeline is ready, but 🛑 **a match streamed without
`?data=1` can never have per-player reels** — no code in the pixels means no names, and nothing
recovers attribution after the fact. That is now a CLAUDE.md tripwire, because it is one query
parameter standing between a match and all of its reels.

⚠ Still unexercised on real footage: several players, both innings, real names, and
`qrscan.py`'s runtime on a 4-hour 4K file.


### Per-player reels (`reels.py`)

One vertical reel per player for a single team: their boundaries when the team bats, their
wickets when it fields. This was the original goal of the whole highlights pipeline and the
thing §8's abandoned ball-strip reader could not support. [highlights.md](./highlights.md) §13.

Three decisions worth keeping:

- 🛑 **`--batting-innings` is required, not inferred.** The payload has no team identity, only
  an innings number. Guessing it inverts every attribution, so it is a required argument and
  `test_reels.py` pins the inversion.
- ⚠ **A run-out belongs to no bowler.** `qrscan.moments()` now emits `bowlerWicket`, true only
  when the bowler's own figure moved, so another fielder's dismissal cannot land in a bowler's
  reel. It defaults true for older scans rather than dropping their wickets.
- 🛑 **Attribution fails silently**, unlike a clip window. A wrong window visibly misses the
  shot; a wrong attribution yields a good clip filed under the wrong person. Hence 19 unit
  tests on the rules and none on the ffmpeg call.

✅ `--vertical` removes the `?data=1` block for free — verified by re-scanning a finished reel:
**0 of 80** keyframes decoded, against 13 of 13 on the source.

Captions travel in a sidecar (`--meta`), because a reel spanning several balls has no single
moment to caption it from.

### 🛑 httplib2 breaks multi-chunk resumable uploads, and a small fixture hides it

The first real reel, 20.7 MB, failed instantly with
`RedirectMissingLocation: Redirected but the response is missing a Location: header`. Google
answers each accepted chunk with **308 Resume Incomplete**; httplib2 0.32 counts 308 as a
redirect and tries to follow it, but a Resume Incomplete carries no `Location`.
`http.follow_redirects = False` fixes it — [publishing.md](./publishing.md) §4c.

⚠ **The lesson is the fixture, not the flag.** The earlier lock test used a 0.7 MB clip, under
the 8 MB chunk size, so it went up in one request and never touched the chunked path. It passed
clean and proved less than it appeared to. A fixture smaller than the chunk size does not
exercise a chunked upload at all — the same shape as the four harness faults in
[highlights.md](./highlights.md) §7b, and the third time this session that a green result came
from an instrument that could not fail.

Also removed a stale dry-run warning still telling the operator their uploads would be locked
private.


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
