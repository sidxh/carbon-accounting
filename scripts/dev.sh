#!/usr/bin/env bash
# Local development stack, zero-payment mode.
#
#   scripts/dev.sh emulators   # Firebase Auth + Firestore emulators (needs Java 21+)
#                              # Storage emulator is not started: STORAGE_BACKEND=local writes to disk.
#   scripts/dev.sh agent       # FastAPI agent on :8000, pointed at the emulators via .env
#   scripts/dev.sh web         # Next.js on :3000
#   scripts/dev.sh seed        # Create the evaluator accounts in the running Auth emulator (same as production)
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
    # A Firestore emulator left behind by a dead firebase process keeps port 8080 and blocks the next start
    # ("port taken"), while Auth (9099) is gone, so sign-in fails with auth/network-request-failed.
    if nc -z 127.0.0.1 8080 2>/dev/null && ! nc -z 127.0.0.1 9099 2>/dev/null; then
      echo "A stale Firestore emulator is holding port 8080 (Auth on 9099 is not running)." >&2
      echo "Its data was never exported. If you do not need it, stop it and run this again:" >&2
      echo "  kill \$(lsof -nP -tiTCP:8080 -sTCP:LISTEN)" >&2
      exit 1
    fi
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
  seed)
    # The same five evaluator accounts as production, created in the running Auth emulator from
    # agent/.test_users.json. Create that file first: python -m scripts.seed_test_users --init --domain <domain>
    cd "$ROOT/agent"
    exec .venv/bin/python -m scripts.seed_test_users --emulator
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
    echo "usage: scripts/dev.sh {emulators|agent|web|seed|reset}" >&2
    exit 2
    ;;
esac
