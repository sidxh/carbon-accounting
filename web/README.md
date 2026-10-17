# NetZero web app

The Next.js front end for NetZero: bill upload, the live inventory with "show bill", the Questions chat, the
questionnaire answer packs and the Solar planner. Copy lives in `messages/` (English, Vietnamese, Japanese);
the design tokens and rules are in [`DESIGN.md`](DESIGN.md).

```bash
pnpm install
pnpm dev          # http://localhost:3000, talks to the agent at NEXT_PUBLIC_AGENT_URL (default http://localhost:8000)
npx tsc --noEmit && pnpm lint
```

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_AGENT_URL` | Base URL of the FastAPI agent |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_APP_ID` | Firebase web config |
| `NEXT_PUBLIC_USE_EMULATORS` | `true` to use the local Auth emulator |

Production values are set in [`apphosting.yaml`](apphosting.yaml); the API key comes from Secret Manager.
See the [root README](../README.md) for the whole system and how to run it end to end.
