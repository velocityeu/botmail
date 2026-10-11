// POST /api/outbound/:id
//   sync key: { status: 'sending' | 'sent' | 'failed' | 'queued', messageId?, threadId?, error? }
//   app key : { status: 'cancelled' }  (only while still queued)
import { auth, body, err, json, lastSegment } from '../_lib/http.js'
import { readOutbound, writeOutbound } from '../_lib/store.js'
import type { OutboundStatus } from '../../shared/types.js'

export async function POST(req: Request) {
  const role = auth(req, 'app'); if (role instanceof Response) return role
  const id = lastSegment(req)
  const b = await body<{ status?: string; messageId?: string; threadId?: string; error?: string }>(req, 20_000)
  if (b instanceof Response) return b
  const status = b?.status as OutboundStatus
  const allowed: OutboundStatus[] = role === 'sync' ? ['sending', 'sent', 'failed', 'queued', 'cancelled'] : ['cancelled']
  if (!allowed.includes(status)) return err(role === 'sync' ? 400 : 403, 'status_not_allowed', { allowed })
  const doc = await readOutbound()
  const it = doc.items.find(i => i.id === id)
  if (!it) return err(404, 'not_found')
  if (status === 'cancelled' && it.status !== 'queued') return err(409, 'not_cancellable', { status: it.status })
  if (status === 'sending' && it.status !== 'queued') return err(409, 'not_queued', { status: it.status })
  it.status = status
  it.updatedAt = new Date().toISOString()
  if (b.messageId) it.messageId = String(b.messageId).slice(0, 300)
  if (b.threadId) it.threadId = String(b.threadId).slice(0, 300)
  if (status === 'failed') it.error = String(b.error || 'send failed').slice(0, 1000); else delete it.error
  await writeOutbound(doc)
  return json({ item: it })
}
