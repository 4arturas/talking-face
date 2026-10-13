#!/usr/bin/env bash
# Linux/macOS: paleidžia vietinį talking-face serverį (HTML + balsai).
#
#   tools/run-server.sh            # http://localhost:3000/talking-face-avatars.html
#   PORT=8080 tools/run-server.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/tts-server/server.mjs" "$@"