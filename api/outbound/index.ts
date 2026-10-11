// Outbound queue. Grok Bot SendEmail can only be called by the agent (CoS),
// so the app enqueues here and CoS drains.
// GET  /api/outbound[?status=queued]   (app or sync key) -> { items }
// POST /api/outbound { to, cc?, subject, body, replyToMessageId?, threadId? }  (app key) -> { item }
import { randomUUID } from 'node:crypto'
import { auth, body, err, json, MAILBOX } from '../_lib/http.js'
import { readOutbound, writeOutbound } from '../_lib/store.js'
import type { OutboundItem, OutboundStatus } from '../../shared/types.js'

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/
const MAX_QUEUE = 300
const STATUSES: OutboundStatus[] = ['queued', 'sending', 'sent', 'failed', 'cancelled']

const addrs = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : [])
  .map(x => String(x).trim().replace(/^.*<([^>]+)>.*$/, '$1').toLowerCase()).filter(Boolean)

export async function GET(req: Request) {
  const a = auth(req, 'app'); if (a instanceof Response) return a
  const s = new URL(req.url).searchParams.get('status')
  const { items } = await readOutbound()
  const out = s && STATUSES.includes(s as OutboundStatus) ? items.filter(i => i.status === s) : items
  return json({ items: [...out].sort((x, y) => x.createdAt.localeCompare(y.createdAt)) })
}

export async function POST(req: Request) {
  const a = auth(req, 'app'); if (a instanceof Response) return a
  const b = await body<Record<string, unknown>>(req, 300_000)
  if (b instanceof Response) return b
  const to = addrs(b?.to), cc = addrs(b?.cc)
  const bad = [...to, ...cc].filter(x => !EMAIL.test(x))
  if (!to.length) return err(400, 'to_required')
  if (bad.length) return err(400, 'invalid_address', { invalid: bad })
  if (to.length + cc.length > 20) return err(400, 'too_many_recipients')
  const text = typeof b.body === 'string' ? b.body.trim() : ''
  if (!text) return err(400, 'body_required')
  const now = new Date().toISOString()
  const item: OutboundItem = {
    id: 'ob_' + randomUUID().replace(/-/g, '').slice(0, 16), from: MAILBOX, to,
    ...(cc.length ? { cc } : {}),
    subject: (typeof b.subject === 'string' && b.subject.trim()) ? b.subject.trim().slice(0, 500) : '(no subject)',
    body: text.slice(0, 100_000),
    ...(typeof b.replyToMessageId === 'string' && b.replyToMessageId ? { replyToMessageId: b.replyToMessageId.slice(0, 300) } : {}),
    ...(typeof b.threadId === 'string' && b.threadId ? { threadId: b.threadId.slice(0, 300) } : {}),
    status: 'queued', createdAt: now, updatedAt: now,
  }
  const doc = await readOutbound()
  if (doc.items.filter(i => i.status === 'queued' || i.status === 'sending').length >= MAX_QUEUE) return err(429, 'queue_full')
  // keep history bounded: drop oldest finished items beyond 500
  const items = [...doc.items, item]
  while (items.length > 500) { const k = items.findIndex(i => i.status !== 'queued' && i.status !== 'sending'); if (k < 0) break; items.splice(k, 1) }
  await writeOutbound({ items })
  return json({ item }, 201)
}
