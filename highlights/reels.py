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

Usage:
    .venv/bin/python reels.py "<video>" events.json -o reels/ \\
        --batting-innings 1 --team "Topguns" --match "Topguns vs Bazzigarz" --vertical
"""
from __future__ import annotations
import argparse
import json
import os
import re

from cut import VERTICAL, WINDOWS, cut, segments

# What counts as a player's own highlight, by the role they were in.
BATTING_TYPES = ('four', 'six')
FIELDING_TYPES = ('wicket',)


def slug(name: str) -> str:
    """'V. KOHLI' -> 'v-kohli'. Stable, filesystem-safe, no accidental collisions."""
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "unknown"


def attribute(moments: list[dict], batting_innings: int) -> dict[str, list[dict]]:
    """Group moments by the player they belong to, keeping only that player's own events.

    Returns {player_name: [moment, ...]}, each moment carrying `_kinds` (the subset of its
    types that earned it a place in THIS player's reel) and `_role` ('bat' or 'bowl').
    """
    out: dict[str, list[dict]] = {}
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
        out.setdefault(player, []).append({**m, "_kinds": kinds, "_role": role})
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


def headline(player: str, moments: list[dict], fig: dict | None) -> str:
    """'V. Kohli 46 (28)' or 'J. Bumrah 3/24 (4.0 ov)' — how a scorecard would say it."""
    who = titlecase(player)
    role = moments[0]["_role"]
    if not fig:
        return f"{who} — {tally(moments)}"
    if role == "bat":
        return f"{who} {fig['runs']} ({fig['balls']})"
    return f"{who} {fig['wickets']}/{fig['runs']} ({over(fig['balls'])} ov)"


def build_title(player: str, moments: list[dict], fig: dict | None, match: str,
                limit: int = 100) -> str:
    """Add detail while it fits, dropping the least important part first.

    The scorecard line matters most, then what is actually in the reel, then the fixture.
    A long team name must not push the player's own figures out of the title.
    """
    head = headline(player, moments, fig)
    # Without figures, headline() already ends in the tally — appending it again would
    # read "Venu S — 1 six — 1 six".
    what = tally(moments) if fig else ""
    # "3/24 (4.0 ov) — 3 wickets" says it twice. But when the reel holds fewer wickets
    # than the innings figure (the stream started late), the count is real information,
    # so only drop it when the two agree.
    if fig and moments[0]["_role"] == "bowl":
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
    role = moments[0]["_role"]
    fig = figures(states, player, role)
    who = titlecase(player)
    title = build_title(player, moments, fig, match)

    lines, t = [], 0.0
    for (a, b, _), m in zip(segs, moments):
        lines.append(ball_line(m, t))
        t += b - a

    head = headline(player, moments, fig)
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
    body.append("Every " + ("boundary" if role == "bat" else "wicket")
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
    ap.add_argument("--vertical", action="store_true",
                    help="crop a 9:16 centre column for a Short (also removes the "
                         "?data=1 block for free)")
    ap.add_argument("--player", help="only this player (substring, case-insensitive)")
    ap.add_argument("--height", type=int, default=1080)
    a = ap.parse_args()

    doc = json.load(open(a.events))
    moments = doc.get("moments") or doc.get("events") or []
    # Present for qrscan output, absent for detect.py — captions degrade, not break.
    states = doc.get("states") or []
    if not moments:
        raise SystemExit(f"{a.events} has no moments — run qrscan.py or detect.py first.")

    by_player = attribute(moments, a.batting_innings)
    if a.player:
        by_player = {k: v for k, v in by_player.items() if a.player.lower() in k.lower()}
    if not by_player:
        raise SystemExit(
            "no moments attributed. Check --batting-innings: innings present are "
            f"{sorted({m.get('innings') for m in moments})}.")

    os.makedirs(a.out, exist_ok=True)
    print(f"{len(moments)} moments -> {len(by_player)} player(s), "
          f"innings {a.batting_innings} batting\n")

    written = []
    for player, ms in sorted(by_player.items(), key=lambda kv: -len(kv[1])):
        ms.sort(key=lambda m: m["t"])
        kinds = {k for m in ms for k in m["_kinds"]}
        segs = segments(ms, types=kinds, windows=WINDOWS)
        if not segs:
            continue
        base = os.path.join(a.out, slug(player))
        print(f"{titlecase(player)}  ({tally(ms)})")
        cut(a.video, segs, base + ".mp4", a.height,
            vf=VERTICAL if a.vertical else None)
        meta = metadata(player, ms, segs, a.match, a.team, states)
        with open(base + ".json", "w") as fh:
            json.dump(meta, fh, indent=1)
        size = os.path.getsize(base + ".mp4") / 1e6
        print(f"  -> {base}.mp4  ({size:.1f} MB)\n     {meta['title']}\n")
        written.append(base)

    print(f"wrote {len(written)} reel(s) to {a.out}/")
    if written:
        print("\nupload one with:")
        print(f"  .venv/bin/python publish.py {written[0]}.mp4 --target shorts \\\n"
              f"      --meta {written[0]}.json --privacy public --confirm")


if __name__ == "__main__":
    main()
