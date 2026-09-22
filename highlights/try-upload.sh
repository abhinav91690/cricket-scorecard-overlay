#!/usr/bin/env bash
# One short command for the interactive first upload.
#
# WHY THIS EXISTS: the OAuth consent flow needs a browser and a TTY, so it has to be run by
# hand rather than by a tool. The full publish.py invocation is long enough to wrap in a
# terminal, and a wrapped paste gets mangled — zsh treats the continuation as a separate
# command. A one-line wrapper cannot wrap.
#
#   ./try-upload.sh [file]        default: testclip.mp4
set -euo pipefail
cd "$(dirname "$0")"
exec .venv/bin/python publish.py "${1:-testclip.mp4}" \
  --target shorts --match "Overlay test" --confirm
