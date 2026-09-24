#!/usr/bin/env bash
# Local development stack, zero-payment mode.
#
#   scripts/dev.sh emulators   # Firebase Auth + Firestore emulators (needs Java 21+)
#                              # Storage emulator is not started: STORAGE_BACKEND=local writes to disk.
#   scripts/dev.sh agent       # FastAPI agent on :8000, pointed at the emulators via .env
#   scripts/dev.sh web         # Next.js on :3000
#
# Run each in its own terminal. Emulator UI: http://127.0.0.1:4000
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# firebase-tools 15 needs Java 21+. Prefer a Homebrew openjdk@21 if present.
if [ -d /opt/homebrew/opt/openjdk@21 ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21
  export PATH="$JAVA_HOME/bin:$PATH"
fi

case "${1:-}" in
  emulators)
    cd "$ROOT"
    exec firebase emulators:start --only auth,firestore --project fir-testing-f96b1 \
      --import ./emulator-data --export-on-exit ./emulator-data
    ;;
  agent)
    cd "$ROOT/agent"
    exec .venv/bin/uvicorn app.main:app --reload --port 8000
    ;;
  web)
    cd "$ROOT/web"
    exec pnpm dev
    ;;
  *)
    echo "usage: scripts/dev.sh {emulators|agent|web}" >&2
    exit 2
    ;;
esac
