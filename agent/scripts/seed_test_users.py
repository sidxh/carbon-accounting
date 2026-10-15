"""Create the evaluator accounts (email + password) in Firebase Auth.

The sign-in page has no sign-up: accounts are made here or in the Firebase console. The credentials live in
a gitignored file, `agent/.test_users.json`, so no password is ever committed or printed:

    [{"email": "evaluator1@example.com", "password": "..."}, ...]

    .venv/bin/python -m scripts.seed_test_users --init --domain siddhantxh.com   # write the file, random passwords
    .venv/bin/python -m scripts.seed_test_users --emulator                       # create them in the Auth emulator
    .venv/bin/python -m scripts.seed_test_users                                  # create/update them in the real project

The real project needs Application Default Credentials (`gcloud auth application-default login`). Running it
again is safe: an existing user gets the file's password and is re-enabled.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from pathlib import Path

AGENT = Path(__file__).resolve().parents[1]
DEFAULT_FILE = AGENT / ".test_users.json"
PROJECT = "fir-testing-f96b1"
COUNT = 5


def init_file(path: Path, domain: str) -> None:
    if path.exists():
        sys.exit(f"{path} already exists; delete it first if you want new passwords.")
    users = [{"email": f"evaluator{i}@{domain}", "password": secrets.token_urlsafe(12)} for i in range(1, COUNT + 1)]
    path.write_text(json.dumps(users, indent=2) + "\n")
    path.chmod(0o600)
    print(f"Wrote {COUNT} accounts to {path} (passwords are in that file, not printed here).")


def load_users(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        sys.exit(f"{path} not found. Create it with --init, or pass --file.")
    users = json.loads(path.read_text())
    for u in users:
        if not u.get("email") or len(u.get("password", "")) < 6:
            sys.exit("Every entry needs an email and a password of at least 6 characters.")
    return users


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", type=Path, default=DEFAULT_FILE)
    ap.add_argument("--emulator", action="store_true", help="use the local Auth emulator instead of the real project")
    ap.add_argument("--init", action="store_true", help="write the credentials file with random passwords, then stop")
    ap.add_argument("--domain", default="example.com", help="email domain for --init")
    ap.add_argument("--project", default=PROJECT)
    args = ap.parse_args()

    if args.init:
        init_file(args.file, args.domain)
        return

    users = load_users(args.file)
    if args.emulator:
        os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = "127.0.0.1:9099"

    import firebase_admin
    from firebase_admin import auth, credentials

    cred = None if args.emulator else credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": args.project})

    for u in users:
        try:
            existing = auth.get_user_by_email(u["email"])
        except auth.UserNotFoundError:
            auth.create_user(email=u["email"], password=u["password"], email_verified=True)
            print(f"created  {u['email']}")
        else:
            auth.update_user(existing.uid, password=u["password"], disabled=False)
            print(f"updated  {u['email']}")
    print(f"Done: {len(users)} accounts in {'the emulator' if args.emulator else args.project}.")


if __name__ == "__main__":
    main()
