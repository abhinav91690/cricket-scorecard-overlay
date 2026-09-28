"""Per-player reels for ONE team: their boundaries when batting, their wickets when bowling.

A personal reel should only contain balls that belong to that player, and which player a
ball belongs to depends on which side of it our team was on:

    our team batting   ->  a four or a six belongs to the STRIKER
    our team fielding  ->  a wicket belongs to the BOWLER

🛑 The payload carries no team identity — only an innings number (see docs/data-code.md
§2), because team names would have cost more bits than the whole rest of the record. So
which innings our team batted has to be told to this tool with --batting-innings. There is
no way to infer it from a recording, and guessing it inverts every attribution: our
batters' boundaries would be credited to the opposition and vice versa.

⚠ A wicket is only credited to the bowler when their OWN figure moved. A run-out raises
the team wicket count while `bowlerWickets` stays put, and crediting that to the bowler
would put another fielder's dismissal in their reel. `qrscan.moments()` carries the
`bowlerWicket` flag for exactly this.

🛑 There is no default crop. The camera framing changes every match and the two roles want
different boxes, so the shape is reviewed per match rather than baked in. Omit a role's
flag to leave it at full frame; pass a list to cut one file per shape and choose after
watching them. `crop.py` draws the candidates on a real frame first.

Usage:
    .venv/bin/python reels.py "<video>" events.json -o reels/ \\
        --batting-innings 1 --team "Topguns" --match "Topguns vs Bazzigarz" \\
        --aspect-bat 4:5,1:1 --aspect-bowl 1:1
"""
from __future__ import annotations
import argparse
import json
import os
import re

from cut import (ASPECTS, DEFAULT_LEAD, DEFAULT_TRAIL, FALLBACK_LEAD_BAT,
                 FALLBACK_LEAD_BOWL, FALLBACK_TRAIL, WINDOWS, crop_filter, cut,
                 merge_clips, segments, segments_at, windows_for)
from detect import probe

# What counts as a player's own highlight, by the role they were in.
BATTING_TYPES = ('four', 'six')
FIELDING_TYPES = ('wicket',)
ROLE_NAME = {'bat': 'batting', 'bowl': 'bowling', 'all': 'allrounder'}


def parse_aspects(spec: str) -> list:
    """"4:5,1:1" -> ['4:5', '1:1']; "" -> [None], meaning leave it uncropped.

    A list cuts one file per shape so they can be compared on screen before anything is
    uploaded. Nothing here has a default shape — see the note in main().
    """
    items = [x.strip() for x in (spec or "").split(",") if x.strip()]
    for x in items:
        if x not in ASPECTS:
            raise SystemExit(f"unknown aspect {x!r}; choose from {', '.join(sorted(ASPECTS))}")
    return items or [None]


def slug(name: str) -> str:
    """'V. KOHLI' -> 'v-kohli'. Stable, filesystem-safe, no accidental collisions."""
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "unknown"


def load_overrides(path: str | None) -> dict:
    """Hand-measured corrections for one match. -> {"shots": {entry: shot}, "drop": {entry}}.

    🛑 Why this exists. Some balls cannot be placed from the video at all, and no amount of
    tuning will place them. The three that needed it on `vs ATX Panthers`:

        entry 8862.4  -> shot 8836.5   the aligner had 8847.5; a 25.9 s lag
        entry 13074.2 -> shot 13027.5  the aligner had 13070.2; a 46.7 s lag, and the
                                       delivery was never among the motion candidates
        entry 13650.5 -> shot 13510.5  a 140 s lag after a 240 s scorer stall; by the
                                       aligner's estimate the NEXT bowler was already on

    Each was read frame by frame — delivery stride, ball in flight, bat on ball — and the
    file records the measurement, not a guess. ⚠ Never populate it from the aligner's own
    output: an override that agrees with the estimate is noise, and one that is itself
    estimated is worse than the estimate it replaces.

    Format, with times in source seconds:

        {"shots": {"8862.4": 8836.5}, "drop": [13650.5], "note": "..."}

    `drop` removes a moment outright, for an event the video cannot support at all or that
    the scorer attributed to the wrong player.
    """
    if not path:
        return {"shots": {}, "drop": set()}
    with open(path) as fh:
        doc = json.load(fh)
    shots = {float(k): float(v) for k, v in (doc.get("shots") or {}).items()}
    return {"shots": shots, "drop": {float(x) for x in (doc.get("drop") or [])}}


def apply_overrides(shots: dict, ov: dict) -> tuple[dict, int]:
    """Replace aligned shot times with hand-measured ones. -> (shots, n applied).

    Keyed on the ENTRY time, which is stable: it comes from the payload, not from the video.
    ⚠ An override for an entry the aligner never placed still counts — that is the main case,
    a ball the video could not supply.
    """
    out = dict(shots)
    n = 0
    for entry, shot in ov["shots"].items():
        hit = [e for e in out if abs(e - entry) < 0.6]
        for e in hit:
            del out[e]
        out[entry] = (shot, shot)
        n += 1
    return out, n


def dedupe_moments(moments: list[dict]) -> tuple[list[dict], int]:
    """Drop moments the scorer entered twice. -> (kept, n dropped).

    🛑 A scorer who retracts a ball and re-enters it produces the SAME event twice, and the
    second copy carries the re-entry's timestamp — 256 s later in the case that exposed this,
    so its clip showed a different player getting out entirely. The state trace:

        9080.7  213/3  10(5)   boundary entered
        9098.1  209/3   6(4)   retracted
        9118.2  213/3  10(5)   re-entered, outcome "4"

    The duplicate is exact — same ball number, score, striker score and outcome — so keeping
    the earliest is both safe and correct: the earlier timestamp is the one nearer the ball.
    ⚠ An independent check caught the same thing: three "fours" for a batter whose figures
    read 10 (5), when three fours is 12 runs.
    """
    seen, kept, dropped = set(), [], 0
    for m in sorted(moments, key=lambda m: m["t"]):
        sig = (m.get("innings"), m.get("ball"), m.get("striker"), m.get("strikerScore"),
               m.get("score"), m.get("outcome"))
        if sig in seen:
            dropped += 1
            continue
        seen.add(sig)
        kept.append(m)
    return kept, dropped


def combine_all_rounders(by_player: dict[tuple, list[dict]]) -> dict[tuple, list[dict]]:
    """Merge a player's batting and bowling moments into one 'all' reel, in time order.

    Each moment keeps its own `_role`, so per-clip widths and the commentary lines stay
    role-correct; only the reel and its caption are shared. ⚠ The reel takes the BATTING crop,
    because a single file can only have one — `docs/highlights.md` §13aa has the trade-off.
    """
    players = {p for p, _ in by_player}
    out: dict[tuple, list[dict]] = {}
    for p in players:
        bat, bowl = by_player.get((p, "bat")), by_player.get((p, "bowl"))
        if bat and bowl:
            out[(p, "all")] = sorted(bat + bowl, key=lambda m: m["t"])
        elif bat:
            out[(p, "bat")] = bat
        elif bowl:
            out[(p, "bowl")] = bowl
    return out


def attribute(moments: list[dict], batting_innings: int) -> dict[tuple, list[dict]]:
    """Group moments by the player AND the role they earned them in.

    Returns {(player_name, role): [moment, ...]}, each moment carrying `_kinds` (the
    subset of its types that put it in THIS reel) and `_role` ('bat' or 'bowl').

    🛑 The key is (player, role), not player. An all-rounder who hits a four and later
    takes a wicket would otherwise get both in one reel, and everything downstream reads
    the role off the first moment — so the reel would be captioned with batting figures
    while containing a wicket. Keyed this way they get two reels, which is also what the
    two roles want anyway: they need different crops (§13a).
    """
    out: dict[tuple, list[dict]] = {}
    for m in moments:
        if m.get("innings") == batting_innings:
            kinds = [t for t in m["types"] if t in BATTING_TYPES]
            player, role = m.get("striker", ""), "bat"
        else:
            # Default True so a moment from an older scan, before `bowlerWicket` existed,
            # is still attributed rather than silently dropped.
            if not m.get("bowlerWicket", True):
                continue
            kinds = [t for t in m["types"] if t in FIELDING_TYPES]
            player, role = m.get("bowler", ""), "bowl"

        if not kinds or not player:
            continue
        out.setdefault((player, role), []).append({**m, "_kinds": kinds, "_role": role})
    return out


def tally(moments: list[dict]) -> str:
    """'2 fours, 1 six' / '3 wickets' — reads naturally in a title."""
    counts = {}
    for m in moments:
        for k in m["_kinds"]:
            counts[k] = counts.get(k, 0) + 1
    plural = {"four": "fours", "six": "sixes", "wicket": "wickets"}
    parts = []
    for kind in ("wicket", "six", "four"):          # most interesting first
        n = counts.get(kind)
        if n:
            parts.append(f"{n} {plural[kind] if n > 1 else kind}")
    return ", ".join(parts)


def titlecase(name: str) -> str:
    """'V. KOHLI' -> 'V. Kohli'. The payload is upper-case; a title should not shout."""
    return " ".join(w[:1] + w[1:].lower() if w else w for w in name.split(" "))


def over(balls: int) -> str:
    """13 legal balls -> '2.1'. Cricket's over.ball notation, not a decimal."""
    return f"{balls // 6}.{balls % 6}"


def figures(states: list[dict], player: str, role: str) -> dict | None:
    """The player's batting or bowling figures, read off the richest state we saw.

    The moment for a given ball only knows the score *at* that ball, so a batter whose
    last boundary came at 20 would be captioned "20" even if they went on to 60. Scanning
    every state for the highest count that player reached gives their real figures for as
    much of the innings as the recording covers.

    ⚠ Returns None when there are no states — `detect.py` output has none, so captions
    must degrade to the tally rather than inventing numbers.
    """
    best = None
    for s in states or []:
        f = s.get("fields", {})
        if role == "bat":
            if f.get("strikerName") != player:
                continue
            cur = {"runs": f.get("strikerRuns", 0), "balls": f.get("strikerBalls", 0),
                   "fours": f.get("strikerFours", 0), "sixes": f.get("strikerSixes", 0)}
            key = (cur["runs"], cur["balls"])
        else:
            if f.get("bowlerName") != player:
                continue
            cur = {"wickets": f.get("bowlerWickets", 0), "runs": f.get("bowlerRuns", 0),
                   "balls": f.get("bowlerBalls", 0), "maidens": f.get("bowlerMaidens", 0)}
            key = (cur["balls"], cur["wickets"])
        if best is None or key > best[0]:
            best = (key, cur)
    return best[1] if best else None


def breakdown(fig: dict | None, role: str) -> str:
    """'3 fours, 2 sixes' from the player's innings figures. Zero counts are omitted —
    a caption reading '1x4, 0x6' looks like a bug."""
    if not fig:
        return ""
    bits = []
    if role == "bat":
        for n, one, many in ((fig["fours"], "four", "fours"), (fig["sixes"], "six", "sixes")):
            if n:
                bits.append(f"{n} {one if n == 1 else many}")
    elif fig.get("maidens"):
        n = fig["maidens"]
        bits.append(f"{n} maiden{'' if n == 1 else 's'}")
    return ", ".join(bits)


def roles_in(moments: list[dict]) -> list[str]:
    """Which roles this reel covers, batting first. One entry normally, two for an all-rounder."""
    have = {m["_role"] for m in moments}
    return [r for r in ("bat", "bowl") if r in have]


def headline(player: str, moments: list[dict], fig: dict | None,
             states: list[dict] | None = None) -> str:
    """'V. Kohli 46 (28)', 'J. Bumrah 3/24 (4.0 ov)', or both for an all-rounder."""
    who = titlecase(player)
    rs = roles_in(moments)
    if len(rs) > 1:
        # An all-rounder needs both sets of figures; `fig` only holds one role's.
        parts = []
        for r in rs:
            f = figures(states, player, r)
            if not f:
                continue
            parts.append(f"{f['runs']} ({f['balls']})" if r == "bat"
                         else f"{f['wickets']}/{f['runs']} ({over(f['balls'])} ov)")
        if parts:
            return f"{who} {' & '.join(parts)}"
        return f"{who} — {tally(moments)}"
    if not fig:
        return f"{who} — {tally(moments)}"
    if rs[0] == "bat":
        return f"{who} {fig['runs']} ({fig['balls']})"
    return f"{who} {fig['wickets']}/{fig['runs']} ({over(fig['balls'])} ov)"


def build_title(player: str, moments: list[dict], fig: dict | None, match: str,
                limit: int = 100, states: list[dict] | None = None) -> str:
    """Add detail while it fits, dropping the least important part first.

    The scorecard line matters most, then what is actually in the reel, then the fixture.
    A long team name must not push the player's own figures out of the title.
    """
    head = headline(player, moments, fig, states)
    # Without figures, headline() already ends in the tally — appending it again would
    # read "Venu S — 1 six — 1 six".
    what = tally(moments) if fig else ""
    # "3/24 (4.0 ov) — 3 wickets" says it twice. But when the reel holds fewer wickets
    # than the innings figure (the stream started late), the count is real information,
    # so only drop it when the two agree.
    if fig and roles_in(moments) == ["bowl"]:
        in_reel = sum(1 for m in moments if "wicket" in m["_kinds"])
        if in_reel == fig.get("wickets"):
            what = ""
    for candidate in (
        f"{head} — {what}" + (f" | {match}" if match else "") if what else "",
        f"{head} — {what}" if what else "",
        f"{head}" + (f" | {match}" if match else ""),
        head,
    ):
        if not candidate:
            continue
        if len(candidate) <= limit:
            return candidate
    return head[:limit]


def ball_line(m: dict, t: float) -> str:
    """One stamped line per ball, in the language of a commentary log."""
    stamp = f"{int(t) // 60:02d}:{int(t) % 60:02d}"
    where = f"{over(m['ball'])} ov, {m.get('score', '')}".strip(", ")
    if m["_role"] == "bat":
        shot = "SIX" if "six" in m["_kinds"] else "FOUR"
        detail = f"{shot} off {titlecase(m['bowler'])}"
        if str(m.get("outcome", "")).endswith("nb"):
            detail += " (off a no-ball)"
    else:
        out = titlecase(m.get("striker", ""))
        detail = f"WICKET — {out} {m.get('strikerScore', '')}".rstrip()
    return f"{stamp}  {detail} — {where}"


def metadata(player: str, moments: list[dict], segs: list, match: str, team: str,
             states: list[dict] | None = None) -> dict:
    """Title, description and tags for one player's reel."""
    rs = roles_in(moments)
    role = rs[0] if len(rs) == 1 else "all"
    fig = figures(states, player, rs[0]) if len(rs) == 1 else None
    who = titlecase(player)
    title = build_title(player, moments, fig, match, states=states)

    lines, t = [], 0.0
    for (a, b, _), m in zip(segs, moments):
        lines.append(ball_line(m, t))
        t += b - a

    head = headline(player, moments, fig, states)
    extra = breakdown(fig, role)
    if extra:
        head += f", {extra}"

    body = [head]
    if match:
        body.append(match)
    # 🛑 The headline is the player's figures for the whole innings; the reel only holds
    # what the recording caught. Those differ whenever the stream started mid-innings, so
    # say which is which rather than leaving a reader to think one of them is wrong.
    body += ["", f"In this reel: {tally(moments)}", *lines, ""]
    # A combined all-rounder reel holds both, so it cannot say "every wicket".
    what = {"bat": "boundary", "bowl": "wicket"}.get(role, "moment")
    body.append("Every " + what
                + " here was found automatically from the scorecard overlay burnt into "
                  "the broadcast — no manual logging.")
    body += ["", "Scorecard overlay: https://score.abhinav.dev", ""]

    tag_words = ["cricket", "highlights"]
    if team:
        tag_words.append(team.lower())
    tag_words += sorted({k for m in moments for k in m["_kinds"]})
    tag_words.append("shorts")
    # #Shorts in the description is what YouTube reads for Shorts discovery.
    body.append(" ".join(f"#{w.replace(' ', '')}" for w in
                         ["Shorts", "Cricket"] + ([team.replace(" ", "")] if team else [])))

    return {"title": title[:100], "description": "\n".join(body)[:5000],
            "tags": list(dict.fromkeys(tag_words))}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("video")
    ap.add_argument("events")
    ap.add_argument("-o", "--out", required=True, help="output directory")
    ap.add_argument("--batting-innings", type=int, required=True, choices=(1, 2),
                    help="🛑 which innings OUR team batted. Not inferable; getting it "
                         "wrong credits every event to the opposition")
    ap.add_argument("--team", default="", help='e.g. "Topguns" — used in the tags')
    ap.add_argument("--match", default="", help='e.g. "Topguns vs Bazzigarz"')
    # 🛑 No default crop, on purpose. The camera framing changes every match, and the two
    # roles want different boxes, so the shape is an INPUT that gets reviewed per match —
    # never a constant baked in here. Omit a role's flag and that role is left at full
    # frame. Pass a list to get one file per shape and pick after watching them.
    # `crop.py` draws the candidates on a real frame to narrow the choice first.
    ap.add_argument("--aspect-bat", default="", metavar="LIST",
                    help="crop shape(s) for BATTING reels, comma-separated "
                         f"({', '.join(sorted(ASPECTS))}). Omit to leave them uncropped. "
                         "A batting crop wants BOTH sets of stumps — the end alternates")
    ap.add_argument("--aspect-bowl", default="", metavar="LIST",
                    help="crop shape(s) for BOWLING reels, comma-separated. Omit to "
                         "leave them uncropped. A bowling crop wants the run-up too, "
                         "so it needs a wider box than batting")
    ap.add_argument("--crop-x-bat", type=float, default=0.5, metavar="F",
                    help="batting crop centre, as a fraction of frame width")
    ap.add_argument("--crop-x-bowl", type=float, default=0.5, metavar="F",
                    help="bowling crop centre, as a fraction of frame width")
    # 🛑 The overlay trails the action by however long the scorer takes to enter the ball,
    # and that is a property of the SCORER, not of cricket: ~5 s on the reference match,
    # 19 s on vs ATX Panthers. Without a measured lag the clip lands in the aftermath and
    # holds the crowd cheering instead of the shot. Measure it, do not assume it.
    ap.add_argument("--lag-bat", type=float, metavar="S",
                    help="seconds the scorer took to enter a BOUNDARY. Measure it: find a "
                         "boundary's entry time in events.json, scrub back to the shot, "
                         "subtract. Omit to keep the legacy windows")
    ap.add_argument("--lag-bowl", type=float, metavar="S",
                    help="seconds to enter a WICKET (longer — a dismissal has more fields)")
    ap.add_argument("--lead", type=float, default=DEFAULT_LEAD, metavar="S",
                    help=f"run-up kept before the shot (default {DEFAULT_LEAD:g}s)")
    ap.add_argument("--trail", type=float, default=DEFAULT_TRAIL, metavar="S",
                    help=f"kept after the shot (default {DEFAULT_TRAIL:g}s)")
    ap.add_argument("--align", action="store_true",
                    help="🛑 the right way: find when each ball was actually BOWLED by "
                         "aligning video motion to the scorer's entries (deliveries.py), "
                         "then cut around that. Needs no lag guess — the lag varied 5-44s "
                         "within one innings on vs ATX Panthers")
    ap.add_argument("--overrides", metavar="JSON",
                    help="hand-measured shot times for balls the video cannot place, and "
                         "moments to drop. See load_overrides()")
    ap.add_argument("--widen", action="store_true",
                    help="🛑 widen a clip when the delivery is uncertain instead of omitting "
                         "the ball. Measured worse on `vs ATX Panthers`: wide clips showed the "
                         "previous batter and a different bowler's over, and pushed the shot "
                         "to the last seconds of a long clip. → highlights.md §6e")
    ap.add_argument("--split-roles", action="store_true",
                    help="give a player who both batted and bowled two reels instead of one "
                         "combined all-rounder reel")
    ap.add_argument("--keep-suspect", action="store_true",
                    help="with --align, keep balls whose scorer lag is a wild outlier. "
                         "🛑 Both mis-alignments ever confirmed by eye were the largest lag "
                         "in their innings, so these are dropped by default")
    ap.add_argument("--player", help="only this player (substring, case-insensitive)")
    ap.add_argument("--height", type=int, default=1080)
    a = ap.parse_args()

    doc = json.load(open(a.events))
    moments = doc.get("moments") or doc.get("events") or []
    moments, n_dup = dedupe_moments(moments)
    _drop = load_overrides(a.overrides)["drop"]
    if _drop:
        before = len(moments)
        moments = [m for m in moments
                   if not any(abs(m["t"] - d) < 0.6 for d in _drop)]
        print(f"  dropped {before - len(moments)} moment(s) listed in {a.overrides}")
    if n_dup:
        print(f"  dropped {n_dup} duplicate moment(s) — the scorer retracted and re-entered "
              f"the same ball, and the re-entry's timestamp is not the ball's")
    # Present for qrscan output, absent for detect.py — captions degrade, not break.
    states = doc.get("states") or []
    os.makedirs(a.out, exist_ok=True)
    if not moments:
        raise SystemExit(f"{a.events} has no moments — run qrscan.py or detect.py first.")

    # One or the other: a measured lag, or the legacy windows. Mixing them silently would
    # give boundaries a measured window and wickets a guessed one.
    shots = {}
    if a.align:
        import deliveries as dv
        for inn in sorted({m["innings"] - 1 for m in moments}):
            if a.widen:
                got = dv.shot_brackets(a.video, states, inn,
                                       cache=f"{a.out}/motion-inn{inn}.npy",
                                       keep_suspect=a.keep_suspect)
            else:
                # 🛑 Not shot_brackets(): that only MARKS a doubtful ball and widens it, so
                # without --widen those balls would get a tight clip on a point nothing
                # vouches for. shot_times() drops them, which is what the review asked for.
                got = {e: (t, t) for e, t in dv.shot_times(
                    a.video, states, inn, cache=f"{a.out}/motion-inn{inn}.npy",
                    keep_suspect=a.keep_suspect).items()}
            shots.update(got)
            n = len(dv.entered_balls(states, inn))
            print(f"  innings {inn + 1}: {len(got)}/{n} balls located in the video")
        ov = load_overrides(a.overrides)
        shots, n_ov = apply_overrides(shots, ov)
        if n_ov:
            print(f"  applied {n_ov} hand-measured override(s) from {a.overrides}")
        if not shots:
            raise SystemExit("--align found no deliveries; check the pitch crop")

    if (a.lag_bat is None) != (a.lag_bowl is None):
        raise SystemExit("pass both --lag-bat and --lag-bowl, or neither")
    if a.lag_bat is not None:
        wins = windows_for(a.lag_bat, a.lag_bowl, a.lead, a.trail)
        print(f"  lag {a.lag_bat:g}s bat / {a.lag_bowl:g}s bowl, "
              f"-{a.lead:g}s/+{a.trail:g}s around the shot "
              f"-> {a.lead + a.trail:g}s per clip")
    elif a.align:
        wins = WINDOWS          # unused: --align cuts from located shot times
    else:
        wins = WINDOWS
        print("  ⚠ using the legacy windows — no --lag-bat/--lag-bowl and no --align, so "
              "these assume the reference match's scorer")

    by_player = attribute(moments, a.batting_innings)
    if not a.split_roles:
        n_before = len(by_player)
        by_player = combine_all_rounders(by_player)
        if len(by_player) < n_before:
            print(f"  combined {n_before - len(by_player)} all-rounder(s) into one reel each")
    if a.player:
        by_player = {k: v for k, v in by_player.items()
                     if a.player.lower() in k[0].lower()}
    if not by_player:
        raise SystemExit(
            "no moments attributed. Check --batting-innings: innings present are "
            f"{sorted({m.get('innings') for m in moments})}.")

    os.makedirs(a.out, exist_ok=True)
    plan = {"bat": parse_aspects(a.aspect_bat), "bowl": parse_aspects(a.aspect_bowl)}
    m = probe(a.video)
    for role in ("bat", "bowl"):
        cx = a.crop_x_bat if role == "bat" else a.crop_x_bowl
        for aspect in plan[role]:
            if aspect is None:
                print(f"  {ROLE_NAME[role]:8} full frame (uncropped — not a Short)")
            else:
                f = crop_filter(m["w"], m["h"], aspect, cx)
                print(f"  {ROLE_NAME[role]:8} {aspect:4} at x={cx:.0%}  ->  "
                      f"{f.split(',')[0]}")
    print(f"\n{len(moments)} moments -> {len(by_player)} reel(s), "
          f"innings {a.batting_innings} batting\n")

    written = []
    for (player, role), ms in sorted(by_player.items(), key=lambda kv: -len(kv[1])):
        ms.sort(key=lambda m: m["t"])
        kinds = {k for m in ms for k in m["_kinds"]}
        if a.align:
            # 🛑 Tight clips, and a ball with no confident delivery is OMITTED. Widening was
            # tried instead and made things worse in three distinct ways, all confirmed by
            # watching: a 28 s clip showed the PREVIOUS batter, a 52 s one showed a different
            # bowler's over, and a 27 s one put the shot at 0:22 of 0:27 so it read as missing
            # even though the delivery was in there. A wrong-player clip is worse than an
            # absent one, and dead lead-in is worse than a short reel. → highlights.md §6e
            clips, wide, missing = [], 0, 0
            for mom in ms:                     # not `m`: that is the probe() dict here
                label = "+".join(mom["_kinds"])
                hit = [t for t in shots if abs(t - mom["t"]) < 0.6]
                if not hit:
                    missing += 1
                    continue
                lo, hi = shots[hit[0]]
                if not a.widen:
                    lo = hi                     # the point estimate, not the span
                elif hi - lo > 0.5:
                    wide += 1
                clips.append([max(0.0, lo - a.lead), hi + a.trail, label])
            if not clips:
                print("     (no located deliveries — skipped)")
                continue
            segs = merge_clips(clips)
            note = [f"{len(segs)} clip(s)"]
            if wide:
                note.append(f"{wide} widened")
            if missing:
                note.append(f"⚠ {missing} ball(s) not located, omitted")
            print(f"     {', '.join(note)}")
        else:
            segs = segments(ms, types=kinds, windows=wins)
        if not segs:
            continue
        meta = metadata(player, ms, segs, a.match, a.team, states)
        print(f"{titlecase(player)} — {ROLE_NAME[role]}  ({tally(ms)})")
        crop_role = "bat" if role in ("bat", "all") else "bowl"
        cx = a.crop_x_bat if crop_role == "bat" else a.crop_x_bowl
        for aspect in plan[crop_role]:
            # The role is in the name because one player can have both reels; the aspect
            # is in it because several shapes can be cut for review side by side.
            base = os.path.join(a.out, f"{slug(player)}-{ROLE_NAME[role]}"
                                       + (f"-{aspect.replace(':', 'x')}" if aspect else ""))
            vf = crop_filter(m["w"], m["h"], aspect, cx) if aspect else None
            cut(a.video, segs, base + ".mp4", a.height, vf=vf)
            # One sidecar per file, so --meta pairs with whichever variant is chosen.
            with open(base + ".json", "w") as fh:
                json.dump(meta, fh, indent=1)
            size = os.path.getsize(base + ".mp4") / 1e6
            print(f"  -> {base}.mp4  ({size:.1f} MB)")
            written.append(base)
        print(f"     {meta['title']}\n")

    print(f"wrote {len(written)} file(s) to {a.out}/")
    if written:
        print("\nupload one with:")
        print(f"  .venv/bin/python publish.py {written[0]}.mp4 --target shorts \\\n"
              f"      --meta {written[0]}.json --privacy public --confirm")


if __name__ == "__main__":
    main()
