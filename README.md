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
| Sync button | UI → `POST /api/sync-request` (pending) → CoS sees it → sync + flush → `done` → UI shows Last synced | Request + UI real. Runs when CoS picks it up |

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
| GET | `/api/sync` | sync | status (thread count, syncedAt, queued, **`syncRequested`**, `syncRequest`) |
| POST | `/api/sync` | sync | upsert snapshot `{threads, mode?: merge\|replace, remove?}` (also closes an unclaimed `pending` sync request) |
| GET | `/api/sync-request` | app | `{request, pending, syncedAt}`; `GET /api/threads` also returns `syncRequest` + `syncPending` |
| POST | `/api/sync-request` | app | Sync button: `{}` opens a request (`status: pending`, `requestedAt`); repeat presses while open bump `presses` |
| POST | `/api/wake-sync` | app | Server-side POST to the Cursor automation webhook to wake CoS for the open request (throttled 60 s) |
| POST | `/api/sync-request` | sync | `{status: running\|done\|failed, error?}` CoS claims / completes it |

The contract types live in `shared/types.ts`. Storage: `botmail/threads.json`, `botmail/outbound.json` and `botmail/sync-request.json`
in the private Blob store `botmail-store` (lhr1). The last write wins, which is fine for one user and one syncing agent.

## Sync button

**Sync = wake Grok Bot.** Tapping Sync does two quick calls and then stops spinning:

1. `POST /api/sync-request` records a pending request (a second tap while open only bumps `presses`).
2. `POST /api/wake-sync` (server-side proxy, token never in the bundle) POSTs the Cursor automation webhook
   (`BOTMAIL_SYNC_WEBHOOK_URL`, `Authorization: Bearer $BOTMAIL_SYNC_WEBHOOK_TOKEN`, body
   `{"source":"botmail-sync-button","requestId":…,"action":"pull-and-flush"}`). Throttled to one wake / 60 s / request.

The UI shows **Waking Grok Bot…** only while those two calls run (each hard-capped at 15 s), then **Grok Bot woken ·
tap Reload** (or **Requested · tap Reload** if the wake failed). It never spins waiting for CoS, because there is no
reliable signal that the parent agent woke. For 3 min it quietly re-reads `/api/threads` every 10 s and flips to
**Last synced …** as soon as CoS acks `done`/`failed` for this request or a new `syncedAt` lands.

**Reload** always re-reads `/api/threads` + `/api/outbound` immediately.

### Who does the pull (important)

Bot Mail cannot pull by itself, and **neither can the webhook-started routine run**: that child run has no
`SearchEmailThreads` / `ReadEmailThread` / `SendEmail`. The webhook is only a doorbell. The **parent CoS agent**
(which holds the Grok Bot mail tools) must handle every `[webhook]` wake of `bot-mail-sync-webhook` by doing the pull
itself, as below. The routine prompt must say so.

### Completion rules (server-enforced)

- `POST /api/sync` never completes a Sync request. An empty, unflagged `POST /api/sync` is a no-op (does not bump
  `syncedAt`).
- `POST /api/sync?source=cos-pull` (helper: `sync - --pull`) means "CoS just pulled the inbox with the mail tools". It
  bumps `syncedAt` and records `pulledAt` on the open request (status → running).
- `POST /api/sync-request {"status":"done"}` returns **409 `pull_required`** unless `pulledAt` is set for this request.
  `{"status":"done","force":true}` (helper `sync-done --force`) is for manual cleanup only (`completedBy: "force"`).

### CoS: on every wake (scheduled or `[webhook]`)

1. `node scripts/botmail.mjs status`: if `syncRequested` is true, AT tapped Sync, so run now.
2. `node scripts/botmail.mjs sync-claim` (status → running).
3. Pull: `SearchEmailThreads` + `ReadEmailThread` → `node scripts/botmail.mjs sync - --pull` (even if nothing is new:
   send `{"threads":[]}` with `--pull`).
4. Flush: `queue` → `SendEmail` each → `ack <id> sent --message-id …` (or `failed`), then re-sync touched threads with `--pull`.
5. `node scripts/botmail.mjs sync-done` (or `sync-fail --error "<short reason>"`).

A `pending`/`running` request untouched for 15 min is treated as abandoned; the next tap re-opens it. Full runbook:
[scripts/sync-from-stdin.md](scripts/sync-from-stdin.md) §0.

## Env vars (Vercel project `botmail`)

- `BLOB_READ_WRITE_TOKEN`: set automatically by the linked Blob store
- `BOTMAIL_APP_KEY`: Production + Preview, sensitive
- `BOTMAIL_SYNC_SECRET`: Production + Preview, sensitive
- `BOTMAIL_SYNC_WEBHOOK_URL`, `BOTMAIL_SYNC_WEBHOOK_TOKEN`: Production + Preview, sensitive, server-only (`/api/wake-sync`)

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
