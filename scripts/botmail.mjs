#!/usr/bin/env node
// CoS helper for the botmail sync + outbound queue. Node 18+, no deps.
//
//   BOTMAIL_SYNC_SECRET=... node scripts/botmail.mjs status
//   node scripts/botmail.mjs sync  snapshot.json      # or "-" / stdin
//   node scripts/botmail.mjs sync  snapshot.json --replace
//   node scripts/botmail.mjs queue                    # list queued outbound (JSON)
//   node scripts/botmail.mjs ack <id> sending
//   node scripts/botmail.mjs ack <id> sent   --message-id <grokMessageId> [--thread-id <grokThreadId>]
//   node scripts/botmail.mjs ack <id> failed --error "reason"
//
// Env: BOTMAIL_URL (default https://botmail.velocitypulse.io)
//      BOTMAIL_SYNC_SECRET (falls back to BOTMAIL_SYNC_SECRET= line in $BOTMAIL_SECRETS_FILE)
import { readFileSync } from 'node:fs'

const BASE = (process.env.BOTMAIL_URL || 'https://botmail.velocitypulse.io').replace(/\/$/, '')
let SECRET = process.env.BOTMAIL_SYNC_SECRET
if (!SECRET && process.env.BOTMAIL_SECRETS_FILE) {
  const m = /^BOTMAIL_SYNC_SECRET=(.+)$/m.exec(readFileSync(process.env.BOTMAIL_SECRETS_FILE, 'utf8'))
  SECRET = m?.[1].trim()
}
if (!SECRET) { console.error('BOTMAIL_SYNC_SECRET not set'); process.exit(2) }

const [cmd, ...args] = process.argv.slice(2)
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }

async function call(path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` } })
  const text = await r.text()
  if (!r.ok) { console.error(`HTTP ${r.status} ${text}`); process.exit(1) }
  return JSON.parse(text)
}
const readIn = async f => f && f !== '-' ? readFileSync(f, 'utf8') : await new Promise(res => { let s = ''; process.stdin.on('data', c => s += c).on('end', () => res(s)) })

let out
if (cmd === 'status') out = await call('/api/sync')
else if (cmd === 'sync') {
  const raw = JSON.parse(await readIn(args.find(a => !a.startsWith('--'))))
  const payload = Array.isArray(raw) ? { threads: raw } : raw
  if (args.includes('--replace')) payload.mode = 'replace'
  out = await call('/api/sync', { method: 'POST', body: JSON.stringify(payload) })
} else if (cmd === 'queue') out = await call('/api/outbound?status=queued')
else if (cmd === 'ack') {
  const [id, status] = args
  out = await call(`/api/outbound/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ status, messageId: opt('--message-id'), threadId: opt('--thread-id'), error: opt('--error') }) })
} else { console.error('usage: status | sync <file|-> [--replace] | queue | ack <id> <sending|sent|failed|queued> [--message-id X] [--thread-id X] [--error X]'); process.exit(2) }
console.log(JSON.stringify(out, null, 2))
