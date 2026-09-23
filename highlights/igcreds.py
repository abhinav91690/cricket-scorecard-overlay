"""Store the Instagram access token from the CLIPBOARD, and verify it on the way in.

Same discipline as r2creds.py and the homelab `keychain-add.sh`: the value is never typed,
never passed in argv, never printed. See publish.py's keychain_write() for the two ways a
naive Keychain write goes wrong silently.

What gets stored under one Keychain entry:

    token        the long-lived Instagram access token
    ig_user_id   the Instagram account id the token belongs to
    username     for confirmation only, so --status can say WHICH account without
                 revealing the token
    stored_at    when it was stored, so the 60-day clock in §8d can be reported

🛑 The token is VERIFIED as it is stored, by calling `GET /me` with it. A token that does
not resolve is refused rather than saved, because the alternative is discovering it on
match day. The verification also supplies the `ig_user_id` every publish call needs, so it
never has to be looked up by hand.

⚠ A long-lived token lasts 60 days and, once expired, **cannot be refreshed at all** — the
whole app flow has to be redone. Using it does not extend it. `--status` reports the days
remaining; `--refresh` extends it (any token at least 24 h old can be refreshed).

Usage — copy the token from the Meta dashboard, then:
    .venv/bin/python igcreds.py --paste
    .venv/bin/python igcreds.py --status
    .venv/bin/python igcreds.py --refresh
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import urllib.parse
import urllib.request

from publish import keychain_read_json, keychain_write, ssl_context

SERVICE = "cricket-overlay-instagram"
GRAPH = "https://graph.instagram.com"
TOKEN_DAYS = 60


def clipboard() -> str:
    """The clipboard, trimmed. Copy buttons often append a newline."""
    out = subprocess.run(["pbpaste"], capture_output=True, text=True, check=True).stdout
    return out.replace("\n", "").replace("\r", "").strip()


def shape(value: str) -> str:
    """A description of the value, never the value itself."""
    return f"{len(value)} chars"


def _get(path: str, **params) -> dict:
    url = f"{GRAPH}{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, context=ssl_context()) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read(400).decode(errors="replace")
        # Meta's errors are JSON; surface the message rather than the raw blob.
        try:
            detail = json.loads(detail).get("error", {}).get("message", detail)
        except Exception:
            pass
        raise SystemExit(f"Instagram API said HTTP {e.code}: {detail}")


def whoami(token: str) -> dict:
    """-> {id, username}. Raises if the token does not resolve."""
    return _get("/me", fields="id,username", access_token=token)


def stored() -> dict:
    return keychain_read_json(SERVICE) or {}


def credentials() -> dict:
    creds = stored()
    if not creds.get("token") or not creds.get("ig_user_id"):
        raise SystemExit(
            f"no Instagram token in the Keychain under '{SERVICE}'.\n"
            "  Copy the token from the Meta dashboard, then: python igcreds.py --paste")
    return creds


def days_left(creds: dict) -> int | None:
    at = creds.get("stored_at")
    if not at:
        return None
    then = dt.datetime.fromisoformat(at)
    return TOKEN_DAYS - (dt.datetime.now(dt.timezone.utc) - then).days


def save(token: str, me: dict) -> dict:
    creds = {"token": token, "ig_user_id": me["id"], "username": me.get("username", ""),
             "stored_at": dt.datetime.now(dt.timezone.utc).isoformat()}
    keychain_write(SERVICE, json.dumps(creds))
    return creds


def report(creds: dict) -> None:
    left = days_left(creds)
    print(f"  account    @{creds.get('username', '?')}  (id {creds.get('ig_user_id')})")
    print(f"  token      set ({shape(creds.get('token', ''))}, not shown)")
    if left is None:
        print("  expires    unknown — stored before the clock was tracked")
    elif left <= 0:
        print(f"  expires    🛑 EXPIRED {-left} day(s) ago — it can no longer be "
              "refreshed; redo the app flow")
    elif left <= 10:
        print(f"  expires    ⚠ in {left} day(s) — run --refresh now")
    else:
        print(f"  expires    in ~{left} day(s)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--paste", action="store_true",
                    help="take the token from the clipboard, verify it, and store it")
    ap.add_argument("--status", action="store_true", help="which account, and days left")
    ap.add_argument("--refresh", action="store_true",
                    help="extend the token by 60 days (needs it to be >24h old)")
    a = ap.parse_args()

    if a.paste:
        token = clipboard()
        if not token:
            raise SystemExit("clipboard is empty — copy the token first")
        if " " in token:
            raise SystemExit(f"that does not look like a token ({shape(token)}, has spaces)")
        # Verify BEFORE storing: a token that does not resolve is worse than no token,
        # because it is only discovered on match day.
        print(f"  verifying the token on the clipboard ({shape(token)})…")
        me = whoami(token)
        creds = save(token, me)
        print("  stored and read back intact\n")
        report(creds)
        print("\n  Nothing was typed, nothing passed through argv, the token was not printed.")
        return

    if a.status:
        report(credentials())
        return

    if a.refresh:
        creds = credentials()
        out = _get("/refresh_access_token", grant_type="ig_refresh_token",
                   access_token=creds["token"])
        new = out.get("access_token")
        if not new:
            raise SystemExit(f"refresh returned no token: {out}")
        me = whoami(new)
        report(save(new, me))
        return

    ap.print_help()


if __name__ == "__main__":
    main()
