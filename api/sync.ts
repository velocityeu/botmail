// CoS-only mirror endpoint (BOTMAIL_SYNC_SECRET).
// POST /api/sync { threads: SnapshotThread[], mode?: 'merge' | 'replace', remove?: string[] }
// GET  /api/sync -> status { threads, syncedAt, queued, sending, syncRequested, syncRequest }
import { auth, body, err, json, MAILBOX } from './_lib/http.js'
import { mergeThread, normThread } from './_lib/normalize.js'
import { isSyncPending, readOutbound, readSyncRequest, readThreads, writeOutbound, writeSyncRequest, writeThreads } from './_lib/store.js'
import type { ApiThread } from '../shared/types.js'

const MAX_THREADS = 1000

export async function GET(req: Request) {
  const a = auth(req, 'sync'); if (a instanceof Response) return a
  const [t, o, sr] = await Promise.all([readThreads(), readOutbound(), readSyncRequest()])
  return json({ mailbox: MAILBOX, threads: t.threads.length, syncedAt: t.syncedAt,
    queued: o.items.filter(i => i.status === 'queued').length,
    sending: o.items.filter(i => i.status === 'sending').length,
    syncRequested: isSyncPending(sr), syncRequest: sr })
}

export async function POST(req: Request) {
  const a = auth(req, 'sync'); if (a instanceof Response) return a
  const b = await body<{ threads?: unknown[]; mode?: string; remove?: unknown[] }>(req, 8_000_000)
  if (b instanceof Response) return b
  if (!b || !Array.isArray(b.threads)) return err(400, 'threads_array_required')
  const explicit = new Set<string>()
  const incoming = b.threads.map(raw => {
    const t = normThread(raw)
    if (t && raw && typeof raw === 'object' && 'folder' in raw) explicit.add(t.id)
    return t
  }).filter((t): t is ApiThread => !!t)
  const rejected = b.threads.length - incoming.length
  const doc = await readThreads()
  const map = new Map<string, ApiThread>(b.mode === 'replace' ? [] : doc.threads.map(t => [t.id, t]))
  let added = 0, updated = 0
  for (const t of incoming) {
    const prev = map.get(t.id)
    if (prev) { map.set(t.id, mergeThread(prev, t, explicit.has(t.id))); updated++ } else { map.set(t.id, t); added++ }
  }
  for (const id of Array.isArray(b.remove) ? b.remove : []) map.delete(String(id))
  const threads = [...map.values()].sort((x, y) => y.lastAt.localeCompare(x.lastAt)).slice(0, MAX_THREADS)
  const syncedAt = new Date().toISOString()
  await writeThreads({ threads, syncedAt })

  // Outbound items whose Grok Bot messageId now appears in the mirror are confirmed delivered: prune old ones.
  const seen = new Set(threads.flatMap(t => t.messages.map(m => m.id)))
  const o = await readOutbound()
  const weekAgo = Date.now() - 7 * 864e5
  const kept = o.items.filter(i => !(i.status === 'sent' && i.messageId && seen.has(i.messageId) && Date.parse(i.updatedAt) < weekAgo))
  if (kept.length !== o.items.length) await writeOutbound({ items: kept })

  // A Sync-button request nobody claimed (still 'pending') is satisfied by any snapshot pushed after it was
  // raised, so a routine that does not know about the button still clears it. A claimed ('running') request
  // stays open until CoS acks done/failed via /api/sync-request (it may still be flushing the outbound queue).
  const sr = await readSyncRequest()
  if (sr.status === 'pending' && sr.requestedAt && sr.requestedAt <= syncedAt) {
    await writeSyncRequest({ ...sr, status: 'done', startedAt: sr.startedAt || syncedAt, completedAt: syncedAt, completedBy: 'sync' })
  }

  return json({ ok: true, mode: b.mode === 'replace' ? 'replace' : 'merge', added, updated, rejected, total: threads.length, syncedAt })
}
