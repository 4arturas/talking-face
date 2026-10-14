#!/usr/bin/env bash
# Linux/macOS wrapper for tools/make_rpm_variant.py (see AGENTS.md, section 4).
# Needs Pillow:  python3 -m pip install --user pillow
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v python3 >/dev/null 2>&1; then
  py=python3
elif command -v python >/dev/null 2>&1; then
  py=python
else
  echo "Python 3 not found." >&2
  exit 1
fi

exec "$py" "$here/make_rpm_variant.py" "$@"
