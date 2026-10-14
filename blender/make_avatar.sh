#!/usr/bin/env bash
# Linux/macOS wrapper for blender/make_avatar.py (see AGENTS.md, section 3).
#
# Usage:
#   blender/make_avatar.sh <output.glb> [preset]
#
# Blender is found in this order:
#   1. $BLENDER (set it to your blender binary to override)
#   2. the portable build under ~/opt/talking-face (see AGENTS.md)
#   3. "blender" on PATH
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${BLENDER:-}" ]; then
  blender="$BLENDER"
elif [ -x "$HOME/opt/talking-face/blender/blender-5.2.2-linux-x64/blender" ]; then
  blender="$HOME/opt/talking-face/blender/blender-5.2.2-linux-x64/blender"
elif command -v blender >/dev/null 2>&1; then
  blender="$(command -v blender)"
else
  echo "Blender not found. Install it or set BLENDER=/path/to/blender" >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "Usage: blender/make_avatar.sh <output.glb> [preset]" >&2
  exit 2
fi

exec "$blender" --background --python "$here/make_avatar.py" -- "$@"
