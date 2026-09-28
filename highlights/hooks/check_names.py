#!/usr/bin/env python3
"""Block a commit that would put a league member's real name into this public repository.

🛑 Why this exists. Three names leaked onto `fix/clip-alignment` before anyone noticed: twice
into module docstrings, and once into the prose of the very section that warns against it. A
fourth is still on `main` in the TypeScript wire-format vectors. Every leak was caught by
grepping the diff by hand *after* committing, which is too late — a public repo keeps every
revision, so the only real fix is to stop the commit.

## Where the names come from

⚠ **Not from this file.** A checked-in list of the names to avoid publishing would itself
publish them. The list is read at runtime from sources that are gitignored or outside the repo:

    highlights/events.json                              scanned match, gitignored
    ~/.config/cricket-scorecard-overlay/names.txt       one name per line, optional

## Fail-open, on purpose

With no name source present the hook prints a warning and allows the commit. It is a safety net
for the one person who has the data locally, not a security boundary — and a clone without
`events.json` must still be committable. ⚠ That means a green run does NOT prove the diff is
clean; it may only mean the hook had nothing to compare against, which is why it says so.

## Install

    git config core.hooksPath .githooks

One repo-level setting, so it applies to every worktree too.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

REPO_SOURCES = ["highlights/events.json"]
HOME_SOURCE = os.path.expanduser("~/.config/cricket-scorecard-overlay/names.txt")

# Names that are placeholders, not people. Keep obviously-fictional fixtures here so the hook
# does not fight the test suite.
ALLOW = {"J. ROOT", "V. KOHLI", "R. SHARMA", "ANKIT K", "HEMANTH B", "A. PLAYER",
         "J. BUMRAH", "OTHER", "MMM"}

# A name is only worth blocking if it could plausibly be prose. Single tokens and very short
# strings produce false positives against ordinary words.
MIN_LEN = 5


def repo_roots() -> list[str]:
    """This checkout, and the MAIN checkout when this is a worktree.

    🛑 A worktree has no `highlights/events.json` — that file is gitignored and lives in the
    main checkout. Looking only at `--show-toplevel` made the hook silently inert in exactly
    the place the work happens: it printed "not a clean bill" and allowed the commit. The main
    checkout is the parent of `--git-common-dir`.
    """
    roots = []
    for args in (["git", "rev-parse", "--show-toplevel"],
                 ["git", "rev-parse", "--git-common-dir"]):
        try:
            out = subprocess.run(args, capture_output=True, text=True, check=True)
            path = out.stdout.strip()
            if args[-1] == "--git-common-dir":
                path = os.path.dirname(os.path.abspath(path))
            if path and path not in roots:
                roots.append(path)
        except Exception:                                 # noqa: BLE001
            pass
    return roots or [os.getcwd()]


def names_from_events(path: str) -> set[str]:
    """Every striker and bowler name in a scanned match."""
    try:
        with open(path) as fh:
            doc = json.load(fh)
    except Exception:                                     # noqa: BLE001
        return set()
    out: set[str] = set()
    for s in doc.get("states") or []:
        f = s.get("fields") or {}
        for key in ("strikerName", "bowlerName"):
            v = f.get(key)
            if isinstance(v, str) and v.strip():
                out.add(v.strip().upper())
    for m in doc.get("moments") or []:
        for key in ("striker", "bowler"):
            v = m.get(key)
            if isinstance(v, str) and v.strip():
                out.add(v.strip().upper())
    return out


def load_names(roots: list[str]) -> tuple[set[str], list[str]]:
    """-> (names, which sources were found)."""
    names: set[str] = set()
    found: list[str] = []
    for root in roots:
        for rel in REPO_SOURCES:
            p = os.path.join(root, rel)
            if os.path.exists(p):
                got = names_from_events(p)
                if got:
                    names |= got
                    found.append(os.path.relpath(p, roots[0]))
    if os.path.exists(HOME_SOURCE):
        try:
            with open(HOME_SOURCE) as fh:
                extra = {ln.strip().upper() for ln in fh if ln.strip()
                         and not ln.startswith("#")}
            if extra:
                names |= extra
                found.append("~/.config/cricket-scorecard-overlay/names.txt")
        except OSError:
            pass
    names = {n for n in names if len(n) >= MIN_LEN and n not in ALLOW}
    return names, found


def staged_additions() -> list[tuple[str, str]]:
    """Added lines in the staged diff, as (file, line). Excludes gitignored paths by design:
    `git diff --cached` only sees what is actually staged."""
    out = subprocess.run(["git", "diff", "--cached", "--unified=0", "--no-color"],
                         capture_output=True, text=True)
    rows, path = [], "?"
    for line in out.stdout.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("+") and not line.startswith("+++"):
            rows.append((path, line[1:]))
    return rows


def hits(names: set[str], rows: list[tuple[str, str]]) -> list[tuple[str, str, str]]:
    """-> [(file, name, line)] for every added line containing a name."""
    if not names:
        return []
    # Word-boundary match, case-insensitive, longest names first so a fuller name is reported
    # rather than a fragment of it.
    pats = [(n, re.compile(r"\b" + re.escape(n).replace(r"\ ", r"\s+") + r"\b", re.I))
            for n in sorted(names, key=len, reverse=True)]
    found = []
    for path, line in rows:
        for name, pat in pats:
            if pat.search(line):
                found.append((path, name, line.strip()[:120]))
                break
    return found


def main() -> int:
    names, sources = load_names(repo_roots())
    if not names:
        print("⚠ check_names: no local name source found "
              "(highlights/events.json or ~/.config/cricket-scorecard-overlay/names.txt).")
        print("  Commit ALLOWED, but the diff was not checked. This is not a clean bill.")
        return 0
    bad = hits(names, staged_additions())
    if not bad:
        print(f"✓ check_names: no league-member names in the staged diff "
              f"({len(names)} names, from {', '.join(sources)}).")
        return 0
    print("🛑 check_names: BLOCKED — the staged diff adds a league member's real name.")
    print("   This repository is public and keeps every revision, so a later fix does not")
    print("   remove it from history.\n")
    for path, name, line in bad[:20]:
        print(f"   {path}\n     matched a name in: {line}")
    if len(bad) > 20:
        print(f"   … and {len(bad) - 20} more")
    print("\n   Use a placeholder instead (J. ROOT, V. KOHLI).")
    print("   To commit anyway: git commit --no-verify")
    return 1


if __name__ == "__main__":
    sys.exit(main())
