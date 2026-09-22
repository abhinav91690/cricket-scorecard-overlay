"""Store and read the R2 S3-API credentials, taking each value from the CLIPBOARD.

Instagram publishing needs the reel reachable by URL, because Meta *fetches* the video
rather than accepting an upload (see docs/publishing.md §8). R2 holds it for the couple of
minutes that takes and hands Meta a presigned URL — time-limited, so the bucket never has
to be public.

Three values are needed, and they go in one Keychain entry:

    access_key_id      identifies the key. Not really secret, but no reason to publish it.
    secret_access_key  the actual secret. Cloudflare shows it EXACTLY ONCE.
    endpoint           https://<ACCOUNT_ID>.r2.cloudflarestorage.com

🛑 Nothing is typed and nothing is passed as an argument. Adapted from the homelab repo's
`keychain-add.sh`, which exists because:
  · `security add-generic-password -w` with no value uses an interactive prompt that
    SILENTLY TRUNCATES AT 128 CHARACTERS — verified there twice on a 183-char JWT, which
    stored as 128 and produced a clean 401 that looked like a bad token, not a bad paste.
  · Passing `-w <value>` puts the secret in argv, where `ps` can read it, and Jamf agents
    run as root on this Mac.
Reading the clipboard avoids the prompt, the argv exposure, and the terminal echo all at
once. The value is never printed.

⚠ These are *R2 API tokens*, a different credential system from a Cloudflare API token —
the `CLOUDFLARE_API_TOKEN` this repo mentions for the Worker deploy is a bearer token for
Cloudflare's own REST API. Same dashboard, similar name, not interchangeable. R2's are an
access key pair signed per-request with AWS SigV4.

🛑 Create the token as **Object Read & Write scoped to the one bucket**, never Admin.

Usage — copy a value on the Cloudflare token screen, then run this; repeat for each:
    .venv/bin/python r2creds.py --paste             # works out which value it is
    .venv/bin/python r2creds.py --paste --as secret # if it cannot tell
    .venv/bin/python r2creds.py --status            # what is stored, what is missing
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess

from publish import keychain_read_json, keychain_write

SERVICE = "cricket-overlay-r2"
BUCKET = "overlay-reels"

FIELDS = ("access_key_id", "secret_access_key", "endpoint")
LABELS = {"access_key_id": "Access Key ID", "secret_access_key": "Secret Access Key",
          "endpoint": "Endpoint", "bucket": "Bucket"}
ALIASES = {"id": "access_key_id", "key": "access_key_id", "access": "access_key_id",
           "secret": "secret_access_key", "endpoint": "endpoint", "url": "endpoint"}

ENDPOINT_RE = re.compile(r"^https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com$")
HEX_RE = re.compile(r"^[0-9a-f]+$", re.I)


def clipboard() -> str:
    """The clipboard, trimmed. Newlines are stripped — a copy button often adds one."""
    out = subprocess.run(["pbpaste"], capture_output=True, text=True, check=True).stdout
    return out.replace("\n", "").replace("\r", "").strip()


def classify(value: str) -> str | None:
    """Which of the three values this looks like, or None when it cannot be told apart.

    ⚠ Deliberately relative, not pinned to exact lengths. The secret is longer than the
    access key id in every S3-compatible scheme, but the precise counts are Cloudflare's
    to change — so an unrecognised shape asks for `--as` rather than guessing wrong and
    filing the secret in the wrong slot.
    """
    if ".r2.cloudflarestorage.com" in value:
        return "endpoint"
    if HEX_RE.match(value):
        if len(value) >= 48:
            return "secret_access_key"
        if len(value) <= 40:
            return "access_key_id"
    return None


def shape(value: str) -> str:
    """A description of the value, never the value itself."""
    kind = "hex" if HEX_RE.match(value) else "mixed"
    return f"{len(value)} chars, {kind}"


def stored() -> dict:
    return keychain_read_json(SERVICE) or {}


def credentials() -> dict:
    """The complete credentials, or a SystemExit explaining what is missing."""
    creds = stored()
    missing = [f for f in FIELDS if not creds.get(f)]
    if missing:
        raise SystemExit(
            "R2 credentials are incomplete in the Keychain under "
            f"'{SERVICE}'.\n  Missing: {', '.join(LABELS[m] for m in missing)}\n"
            "  Copy each value on the Cloudflare R2 API token screen and run:\n"
            "    python r2creds.py --paste")
    return {**creds, "bucket": creds.get("bucket") or BUCKET}


def save(field: str, value: str) -> None:
    creds = stored()
    creds[field] = value
    creds.setdefault("bucket", BUCKET)
    # keychain_write() reads back and compares EXACTLY — the homelab script compares
    # lengths, which would miss a mangled-but-same-length paste.
    keychain_write(SERVICE, json.dumps(creds))


def report() -> None:
    creds = stored()
    print(f"\n  Keychain entry '{SERVICE}':")
    for f in FIELDS:
        v = creds.get(f)
        if not v:
            print(f"    {LABELS[f]:18} — not set")
        elif f == "secret_access_key":
            print(f"    {LABELS[f]:18} set ({shape(v)}, not shown)")
        else:
            print(f"    {LABELS[f]:18} {v}")
    print(f"    {LABELS['bucket']:18} {creds.get('bucket') or BUCKET}")
    missing = [LABELS[f] for f in FIELDS if not creds.get(f)]
    print(f"\n  {'still needed: ' + ', '.join(missing) if missing else 'complete ✅'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--paste", action="store_true",
                    help="take the value from the clipboard and store it")
    ap.add_argument("--as", dest="field", choices=sorted(set(ALIASES)),
                    help="say which value it is, when --paste cannot tell")
    ap.add_argument("--status", action="store_true",
                    help="what is stored and what is still missing")
    a = ap.parse_args()

    if a.status:
        report()
        return

    if not a.paste:
        ap.print_help()
        return

    value = clipboard()
    if not value:
        raise SystemExit("clipboard is empty — copy the value first")

    field = ALIASES[a.field] if a.field else classify(value)
    if not field:
        raise SystemExit(
            f"cannot tell what this is ({shape(value)}).\n"
            "  Re-run saying which, e.g.:  python r2creds.py --paste --as secret")

    if field == "endpoint":
        value = value.rstrip("/")
        # A mistyped endpoint fails much later as a DNS error that looks nothing like a
        # bad credential, so check the shape while the token screen is still open.
        if not ENDPOINT_RE.match(value):
            raise SystemExit(
                f"that does not look like an R2 S3 endpoint:\n    {value}\n"
                "  Expected https://<32-hex-account-id>.r2.cloudflarestorage.com")

    save(field, value)
    # The value itself is never echoed; only which slot it went into and its shape.
    print(f"  stored {LABELS[field]} ({shape(value)}) and read it back intact")
    report()


if __name__ == "__main__":
    main()
