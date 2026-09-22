"""Put a reel in R2, hand out a time-limited URL for it, then delete it.

Instagram needs the video reachable by URL because Meta *fetches* it rather than accepting
an upload (docs/publishing.md §8). So a reel goes up, Meta pulls it, and it comes straight
back down — the bucket is never public and the URL expires.

🛑 SigV4 is implemented here rather than with boto3, deliberately:
  · boto3 + botocore is ~50 MB for three operations, against a requirements.txt that
    carries a justifying comment per line.
  · The venv lives in the main checkout, so installing there would mutate an environment
    other sessions share.
  · **A signing bug fails loudly.** A wrong signature is a 403 — it can never produce a
    wrong-but-accepted result. That is the opposite of the silent-failure class that has
    bitten this repo repeatedly, and it is what makes hand-rolling defensible here when
    normally it would not be. `--selftest` proves the whole chain against the live bucket.

R2 specifics: the region is always the literal string `auto`, and the service is `s3`.

Usage:
    .venv/bin/python r2.py --selftest                 # prove signing against live R2
    .venv/bin/python r2.py --put reel.mp4             # -> prints a presigned URL
    .venv/bin/python r2.py --delete <key>
    .venv/bin/python r2.py --list
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import os
import secrets
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from publish import ssl_context
from r2creds import credentials

REGION = "auto"          # R2 ignores the region but SigV4 requires one; it must be "auto"
SERVICE = "s3"
ALGORITHM = "AWS4-HMAC-SHA256"
DEFAULT_EXPIRY = 3600    # 1 h — Meta's transcode can take minutes, and retries happen

# Keys are random so that a leaked URL reveals nothing and nothing can be enumerated.
KEY_PREFIX = "reels/"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: str) -> str:
    """Streamed, so a 75 MB reel is not held in memory twice."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _signing_key(secret: str, datestamp: str) -> bytes:
    """The SigV4 four-step HMAC chain: date -> region -> service -> aws4_request."""
    def step(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()
    k = step(f"AWS4{secret}".encode(), datestamp)
    k = step(k, REGION)
    k = step(k, SERVICE)
    return step(k, "aws4_request")


def _quote_key(key: str) -> str:
    """URI-encode an object key. `/` stays a separator; `~` is unreserved in SigV4."""
    return urllib.parse.quote(key, safe="/~")


def _parts(creds: dict) -> tuple[str, str]:
    """-> (host, scheme://host) from the stored endpoint."""
    u = urllib.parse.urlsplit(creds["endpoint"])
    return u.netloc, f"{u.scheme}://{u.netloc}"


def presign_get(key: str, expires: int = DEFAULT_EXPIRY, creds: dict | None = None) -> str:
    """A URL that anyone can GET, for `expires` seconds, without credentials.

    Query-string SigV4. The signature covers the method, path, the query parameters and
    the host header, so none of them can be altered — a tampered URL is a 403, not a
    different object.
    """
    creds = creds or credentials()
    host, base = _parts(creds)
    now = dt.datetime.now(dt.timezone.utc)
    amzdate, datestamp = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    scope = f"{datestamp}/{REGION}/{SERVICE}/aws4_request"

    canonical_uri = f"/{creds['bucket']}/{_quote_key(key)}"
    query = {
        "X-Amz-Algorithm": ALGORITHM,
        "X-Amz-Credential": f"{creds['access_key_id']}/{scope}",
        "X-Amz-Date": amzdate,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": "host",
    }
    # Canonical query must be sorted by key, with RFC3986 encoding.
    canonical_query = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
        for k, v in sorted(query.items()))

    canonical_request = "\n".join([
        "GET", canonical_uri, canonical_query,
        f"host:{host}\n", "host", "UNSIGNED-PAYLOAD",
    ])
    to_sign = "\n".join([ALGORITHM, amzdate, scope, _sha256(canonical_request.encode())])
    signature = hmac.new(_signing_key(creds["secret_access_key"], datestamp),
                         to_sign.encode(), hashlib.sha256).hexdigest()
    return f"{base}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"


def _signed_request(method: str, key: str, body: bytes | None, payload_hash: str,
                    creds: dict, content_type: str | None = None,
                    query: str = "") -> urllib.request.Request:
    """A header-signed SigV4 request. Used for PUT, DELETE and LIST."""
    host, base = _parts(creds)
    now = dt.datetime.now(dt.timezone.utc)
    amzdate, datestamp = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    scope = f"{datestamp}/{REGION}/{SERVICE}/aws4_request"

    canonical_uri = f"/{creds['bucket']}" + (f"/{_quote_key(key)}" if key else "")
    headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amzdate}
    if content_type:
        headers["content-type"] = content_type
    # Canonical headers: lower-cased names, sorted, trimmed values, trailing newline.
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))

    canonical_request = "\n".join([
        method, canonical_uri, query, canonical_headers, signed_headers, payload_hash,
    ])
    to_sign = "\n".join([ALGORITHM, amzdate, scope, _sha256(canonical_request.encode())])
    signature = hmac.new(_signing_key(creds["secret_access_key"], datestamp),
                         to_sign.encode(), hashlib.sha256).hexdigest()

    headers["Authorization"] = (
        f"{ALGORITHM} Credential={creds['access_key_id']}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}")
    url = f"{base}{canonical_uri}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    return req


def _send(req: urllib.request.Request) -> tuple[int, bytes]:
    # ssl_context() is why this works behind the corporate proxy at all — see
    # docs/publishing.md §4b for the three distinct TLS failures on this machine.
    with urllib.request.urlopen(req, context=ssl_context()) as r:
        return r.status, r.read()


def put(path: str, key: str | None = None, creds: dict | None = None) -> str:
    """Upload a file and return its object key. Content type is fixed to video/mp4."""
    creds = creds or credentials()
    key = key or f"{KEY_PREFIX}{secrets.token_hex(16)}.mp4"
    # The payload hash is computed rather than sent as UNSIGNED-PAYLOAD, so the upload is
    # integrity-checked end to end: a corrupted body fails the signature.
    digest = _sha256_file(path)
    with open(path, "rb") as fh:
        body = fh.read()
    req = _signed_request("PUT", key, body, digest, creds, content_type="video/mp4")
    status, _ = _send(req)
    if status not in (200, 201):
        raise SystemExit(f"upload failed: HTTP {status}")
    return key


def delete(key: str, creds: dict | None = None) -> int:
    creds = creds or credentials()
    req = _signed_request("DELETE", key, None, _sha256(b""), creds)
    status, _ = _send(req)
    return status


def listing(creds: dict | None = None) -> list[tuple[str, int]]:
    """-> [(key, size)] for everything in the bucket."""
    creds = creds or credentials()
    req = _signed_request("GET", "", None, _sha256(b""), creds, query="list-type=2")
    _, body = _send(req)
    ns = "{http://s3.amazonaws.com/doc/2006-03-01/}"
    root = ET.fromstring(body)
    return [(c.findtext(f"{ns}Key") or "", int(c.findtext(f"{ns}Size") or 0))
            for c in root.findall(f"{ns}Contents")]


def selftest() -> None:
    """Prove the whole signing chain against the live bucket.

    🛑 The point of this is that it cannot pass by accident. An unauthenticated GET of a
    presigned URL either returns the exact bytes or a 403 — there is no middle outcome for
    a wrong signature. It also checks a TAMPERED URL is refused, because a presign that
    signs nothing useful would still fetch.
    """
    creds = credentials()
    blob = secrets.token_bytes(2048)
    key = f"{KEY_PREFIX}selftest-{secrets.token_hex(8)}.bin"
    print(f"  bucket {creds['bucket']} at {creds['endpoint']}")

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as fh:
        fh.write(blob)
        tmp = fh.name
    try:
        print("  1. signed PUT …", end=" ", flush=True)
        put(tmp, key=key, creds=creds)
        print("ok")

        print("  2. presign + unauthenticated GET …", end=" ", flush=True)
        url = presign_get(key, expires=120, creds=creds)
        with urllib.request.urlopen(url, context=ssl_context()) as r:
            got = r.read()
        assert got == blob, f"presigned GET returned {len(got)} bytes, expected {len(blob)}"
        print(f"ok — {len(got)} bytes, byte-exact")

        print("  3. tampered URL must be refused …", end=" ", flush=True)
        bad = url.replace(f"{KEY_PREFIX}selftest", f"{KEY_PREFIX}sel1test")
        try:
            urllib.request.urlopen(bad, context=ssl_context())
            raise SystemExit("FAIL: a tampered URL was accepted")
        except urllib.error.HTTPError as e:
            assert e.code in (403, 404), f"expected 403/404, got {e.code}"
            print(f"ok — HTTP {e.code}")

        print("  4. signed DELETE …", end=" ", flush=True)
        print(f"ok — HTTP {delete(key, creds)}")

        print("  5. gone from the listing …", end=" ", flush=True)
        assert key not in [k for k, _ in listing(creds)], "object survived the delete"
        print("ok")
    finally:
        os.unlink(tmp)
    print("\n  ✅ signing, presigning, tamper-rejection, delete — all verified live")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--selftest", action="store_true", help="prove signing against live R2")
    ap.add_argument("--put", metavar="FILE", help="upload and print a presigned URL")
    ap.add_argument("--expires", type=int, default=DEFAULT_EXPIRY)
    ap.add_argument("--delete", metavar="KEY")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        selftest()
    elif a.put:
        key = put(a.put)
        size = os.path.getsize(a.put) / 1e6
        print(f"  uploaded {size:.1f} MB as {key}")
        print(f"  presigned for {a.expires}s:\n{presign_get(key, a.expires)}")
    elif a.delete:
        print(f"  HTTP {delete(a.delete)}")
    elif a.list:
        rows = listing()
        for k, s in rows:
            print(f"  {s/1e6:8.2f} MB  {k}")
        print(f"  {len(rows)} object(s)")
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
