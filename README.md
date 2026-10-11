# Bot Mail

Metal-style web client for the Grok Bot inbox **alexandertr@mail.grokbot.com**.
Vite + React + TypeScript front end, Vercel Functions API, private Vercel Blob storage.

**Live:** https://botmail.velocitypulse.io · iOS / macOS shells: **on hold**.

## How real mail works (agent-mediated)

Grok Bot mail has no public API. Only an agent with the Grok Bot email tools can read or send.
So Bot Mail is a **mirror plus outbound queue**, and CoS (the agent) is the bridge:

| | Path | Real today? |
|---|---|---|
| Read | CoS `SearchEmailThreads`/`ReadEmailThread` → `POST /api/sync` → Blob → `GET /api/threads` → UI | API + UI real. Data appears only after CoS syncs |
| Send / reply | UI → `POST /api/outbound` (queued) → CoS `SendEmail` → `ack sent` → UI shows SENT | Queue + UI real. Delivery happens when CoS drains |
| Read / star / archive / trash | Per-device flags in `localStorage` | Local only, not written back to Grok Bot |
| Attachments | Names/sizes shown | Files are not mirrored; no attaching yet |

Runbook for CoS: **[scripts/sync-from-stdin.md](scripts/sync-from-stdin.md)**. Helper CLI: `scripts/botmail.mjs`.

## API

All endpoints take `Authorization: Bearer <key>`. **app** = `BOTMAIL_APP_KEY` (the web app), **sync** =
`BOTMAIL_SYNC_SECRET` (CoS). The sync secret is accepted everywhere.

| Method | Path | Key | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | config/storage check, no data |
| GET | `/api/threads` | app | `{threads, syncedAt, mailbox}` newest first |
| GET | `/api/threads/:id` | app | `{thread}` |
| POST | `/api/outbound` | app | queue `{to, cc?, subject, body, replyToMessageId?, threadId?}` → `{item}` |
| POST | `/api/send` | app | alias of the above |
| GET | `/api/outbound[?status=]` | app | queue + history |
| POST | `/api/outbound/:id` | app: `{status:"cancelled"}` while queued · sync: `sending/sent/failed/queued` + `messageId`, `error` |
| GET | `/api/sync` | sync | status (thread count, syncedAt, queued) |
| POST | `/api/sync` | sync | upsert snapshot `{threads, mode?: merge\|replace, remove?}` |

The contract types live in `shared/types.ts`. Storage: `botmail/threads.json` and `botmail/outbound.json`
in the private Blob store `botmail-store` (lhr1). The last write wins, which is fine for one user and one syncing agent.

## Env vars (Vercel project `botmail`)

- `BLOB_READ_WRITE_TOKEN`: set automatically by the linked Blob store
- `BOTMAIL_APP_KEY`: Production + Preview, sensitive
- `BOTMAIL_SYNC_SECRET`: Production + Preview, sensitive

The values are not in git. The box keeps a copy at `/workspace/botmail/.env.botmail-secrets` (chmod 600).

## Local dev

```bash
npm install
npm run dev        # Vite serves the real api/ handlers against .mock-store/ (seeded from scripts/sample-snapshot.json)
                   # app key: dev   sync secret: dev-sync
BOTMAIL_URL=http://localhost:5173 BOTMAIL_SYNC_SECRET=dev-sync node scripts/botmail.mjs status
npm run build      # typechecks src + api, builds dist/
```

The app also has a **sample data** mode (Connect screen → "Explore with sample data"). It is offline and delivers nothing.

## Layout

- ≥900px: three panes (sidebar, list, reader); <900px: single-pane phone flow, drawer, bottom-sheet compose
- Installable PWA; `?frame=ios` / `?frame=mac` are mock-renderer helpers only

## Deploy

Vercel project `botmail` (team ve-locity-eu), domain `botmail.velocitypulse.io`: `vercel --prod`.
