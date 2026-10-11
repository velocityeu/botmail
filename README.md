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

The metal **Sync** plate in the sidebar (and the round sync knob in the list header on phones) is visible whenever the
app is connected. Pressing it calls `POST /api/sync-request`, which writes `botmail/sync-request.json`
`{id, status: "pending", requestedAt, requestedBy, presses}`. The button then shows **Syncing…** and the app polls
`GET /api/sync-request` every 4 s for about 2 min. When the request turns `done` (or `failed`) it reloads mail and shows
**Last synced …** (or the error). If nobody picks it up within 2 min it shows "Requested … · waiting for Grok Bot" and
falls back to the normal 45 s poll.

Bot Mail cannot run a sync by itself (only the agent has the Grok Bot mail tools), so the button is a *request* to CoS.

**Waking CoS.** Right after the request is recorded the app calls `POST /api/wake-sync` (fire-and-forget). That
server-side proxy POSTs the Cursor automation webhook (`BOTMAIL_SYNC_WEBHOOK_URL`, `Authorization: Bearer
$BOTMAIL_SYNC_WEBHOOK_TOKEN`, body `{"source":"botmail-sync-button","requestId":…}`), which starts the CoS automation
immediately; CoS then sees the pending request and runs the routine below. The token lives only in server env (never
`VITE_`, never in the bundle); browser → api2.cursor.sh would be CORS-blocked anyway. Wakes are throttled to one per
60 s per open request (`wokeAt`/`wakes` on the request). The UI shows "Requested · waking Grok Bot" → "Grok Bot woken ·
waiting" while polling. A failed wake does not cancel the request; the scheduled CoS run still honours it.

**Reload** always re-reads `/api/threads` + `/api/outbound` immediately; it never waits for CoS.

### CoS: honour the button (add this to the Bot Mail sync + flush routine)

At the **start of every run** of the CoS Bot Mail sync+flush routine, and whenever it wakes:

1. `node scripts/botmail.mjs status` → if `syncRequested` is `true` (equivalently `sync-request` → `pending: true`),
   AT pressed Sync: **run now**, do not wait for the next scheduled slot.
2. `node scripts/botmail.mjs sync-claim` → status `running` (UI keeps showing Syncing…).
3. Run the normal routine: pull Grok Bot mail → `POST /api/sync`, then drain the outbound queue (`queue` / `ack`),
   then re-sync the threads you sent on.
4. `node scripts/botmail.mjs sync-done` (or `sync-fail --error "<short reason>"`). The UI flips to Last synced.

Use a short-interval check (e.g. every 1–2 min, just `status`, cheap) so a press is honoured within the UI's 2-minute
window; the full sync+flush only runs when `syncRequested` is true or the regular slot is due. A routine that does not
know about the button still clears an unclaimed request on its next `POST /api/sync`, but it will not flush the queue
early, so claiming + `sync-done` is preferred. A `running` request older than 15 min is treated as abandoned and the
next press re-opens it. Full runbook: [scripts/sync-from-stdin.md](scripts/sync-from-stdin.md) §0.

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
