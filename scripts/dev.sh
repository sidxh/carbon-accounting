#!/usr/bin/env bash
# Local development stack, zero-payment mode.
#
#   scripts/dev.sh emulators   # Firebase Auth + Firestore emulators (needs Java 21+)
#                              # Storage emulator is not started: STORAGE_BACKEND=local writes to disk.
#   scripts/dev.sh agent       # FastAPI agent on :8000, pointed at the emulators via .env
#   scripts/dev.sh web         # Next.js on :3000
#   scripts/dev.sh reset       # Wipe every supplier: emulator snapshot + uploaded files. Emulators must be stopped.
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
  reset)
    # The emulator exports to emulator-data/ when it exits, which would bring
    # everything straight back. Refuse while it is running.
    if nc -z 127.0.0.1 8080 2>/dev/null || nc -z 127.0.0.1 9099 2>/dev/null; then
      echo "Emulators are running. Stop them with Ctrl-C first, then run reset." >&2
      exit 1
    fi
    rm -rf "$ROOT/emulator-data" "$ROOT/agent/.local_storage/suppliers" "$ROOT/agent/.local_storage/e2e"
    echo "Wiped emulator-data/, agent/.local_storage/suppliers/ and e2e screenshots."
    echo "Gemini cache kept, so re-uploading the golden bills is still instant. Next 'dev.sh emulators' starts empty."
    ;;
  *)
    echo "usage: scripts/dev.sh {emulators|agent|web|reset}" >&2
    exit 2
    ;;
esac
