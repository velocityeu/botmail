# CoS runbook: mirror the Grok Bot inbox into botmail

Bot Mail cannot talk to Grok Bot mail itself. Only an agent (CoS) holding the
Grok Bot email tools (`SearchEmailThreads`, `ReadEmailThread`, `SendEmail`) can.
So the agent is the bridge:

```
Grok Bot inbox ──(CoS: Search/ReadEmailThread)──▶ POST /api/sync ──▶ Blob ──▶ web app
web app ──▶ POST /api/outbound (queue) ──(CoS: drain + SendEmail)──▶ recipient
```

## Secrets

- `BOTMAIL_SYNC_SECRET`: CoS only. Set in Vercel (Production + Preview, sensitive). A box copy is in
  `/workspace/botmail/.env.botmail-secrets` (chmod 600, gitignored). Never paste it into chat.
- `BOTMAIL_APP_KEY`: the key AT types into the web app's Connect screen. Same file.

```bash
export BOTMAIL_SECRETS_FILE=/workspace/botmail/.env.botmail-secrets   # helper reads the sync secret from here
node scripts/botmail.mjs status
```

## 0. Smoke test once with SAMPLE data, then remove it

```bash
node scripts/botmail.mjs sync scripts/sample-snapshot.json     # adds 2 threads with ids sample-*
# open https://botmail.velocitypulse.io, check they show, then replace with real mail (step 1, --replace)
```

## 1. Receive: pull from Grok Bot and push a snapshot

1. `ListEmailInboxes` → confirm `alexandertr@mail.grokbot.com`.
2. `SearchEmailThreads` with `inbox_email: "alexandertr@mail.grokbot.com"`, a broad query (e.g. `"*"` or
   `"mail"`), `limit: 25`, and `after:` set to the last `syncedAt` from `status` for incremental runs.
3. For each thread id: `ReadEmailThread { thread_id, max_messages: 50 }`.
4. Build JSON in the shape below and pipe it in:

```bash
node scripts/botmail.mjs sync - <<'JSON'
{ "threads": [
  { "id": "<thread_id from SearchEmailThreads>",
    "subject": "<subject>",
    "messages": [
      { "id": "<message id from ReadEmailThread>",
        "from": "Jane Doe <jane@example.com>",
        "to": "alexandertr@mail.grokbot.com",
        "cc": "optional",
        "date": "2026-10-11T20:49:00Z",
        "body": "<plain text body>",
        "attachments": [{ "name": "file.pdf", "size": "120 KB" }] } ] } ] }
JSON
```

Accepted field aliases (whatever is closest to the tool output is fine):
thread `id|threadId|thread_id`; message `id|messageId|message_id`, `from|sender` (string `"Name <a@b>"`,
bare address, or `{name,email}`), `fromAddr` (with `from` as name), `to`/`cc` (string or array),
`date|sentAt|receivedAt|timestamp`, `body|text|snippet`. Optional thread fields:
`folder` (`inbox|sent|archive|trash|drafts`; default: `sent` if every message is from the inbox address,
else `inbox`), `labels` (`bots|field|builds|calendar` render in the UI), `unread`, `starred`, `bot`.

Modes:
- default `merge`: upsert threads by id, union messages by id. Safe to re-send.
- `--replace` (or `"mode":"replace"`): the snapshot becomes the whole mailbox. Use it for the first real
  sync to remove the `sample-*` threads.
- `"remove": ["thread-id", ...]` deletes specific threads.

Limits: 8 MB per request, 1000 threads kept, 100k chars per body.

## 2. Send: drain the outbound queue

```bash
node scripts/botmail.mjs queue          # JSON list, oldest first
```

For each item:

1. `node scripts/botmail.mjs ack <id> sending` (claims it; a 409 means someone else has it, so skip it)
2. Grok Bot `SendEmail`:
   - `from`: `alexandertr@mail.grokbot.com` (= `item.from`)
   - `to`: `item.to`, `cc`: `item.cc`
   - `subject`: `item.subject`, `body`: `item.body`
   - `replyToMessageId`: `item.replyToMessageId` when present (the app already sets `Re: …` subjects)
3. Success: `node scripts/botmail.mjs ack <id> sent --message-id <id returned by SendEmail>`
   Failure: `node scripts/botmail.mjs ack <id> failed --error "<reason>"`
4. Run step 1 again (at least for that thread) so the sent message is mirrored. The app hides the queued
   copy once a synced message carries the same `messageId`.

The user wrote and queued every item in the app themselves (only the app key or the sync secret can
enqueue). Whether CoS may send without asking again is up to AT's standing instructions for the agent.

## 3. Cadence

Run steps 1 and 2 together on a routine (e.g. every 5–15 min) or when AT says "sync mail". The app polls
the API every 45 s and when the tab regains focus, and it shows "synced N min ago" and the queue count.

## Raw HTTP (no helper)

```
Authorization: Bearer $BOTMAIL_SYNC_SECRET
GET  /api/sync                       status
POST /api/sync                       {threads, mode?, remove?}
GET  /api/outbound?status=queued     queue
POST /api/outbound/:id               {status: sending|sent|failed|queued|cancelled, messageId?, threadId?, error?}
```
