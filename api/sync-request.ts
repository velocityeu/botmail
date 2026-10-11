// "Sync now" button support.
//
// GET  /api/sync-request            (app or sync key) -> { request, pending, syncedAt }
// POST /api/sync-request            (app or sync key) {}               -> raise a sync request (status pending)
// POST /api/sync-request            (sync key only)   { status: 'running' | 'done' | 'failed', error? }
//                                                                       -> CoS claims / completes the request
//
// Pressing Sync while a request is already pending/running does not create a new one; it bumps `presses`.
// A pending/running request older than STALE_MS is treated as abandoned and a new press re-opens it as pending.
import { randomUUID } from 'node:crypto'
import { auth, err, json } from './_lib/http.js'
import { isSyncPending, readSyncRequest, readThreads, writeSyncRequest } from './_lib/store.js'
import type { SyncRequest, SyncRequestResponse, SyncRequestStatus } from '../shared/types.js'

const STALE_MS = 15 * 60_000

async function view(r: SyncRequest): Promise<Response> {
  const t = await readThreads()
  const out: SyncRequestResponse = { request: r, pending: isSyncPending(r), syncedAt: t.syncedAt }
  return json(out)
}

export async function GET(req: Request) {
  const a = auth(req, 'app'); if (a instanceof Response) return a
  return view(await readSyncRequest())
}

export async function POST(req: Request) {
  const role = auth(req, 'app'); if (role instanceof Response) return role
  const text = await req.text()
  if (text.length > 20_000) return err(413, 'payload_too_large')
  let status: SyncRequestStatus | undefined, error: string | undefined
  if (text.trim()) {
    let b: { status?: string; error?: string } | null
    try { b = JSON.parse(text) } catch { return err(400, 'invalid_json') }
    status = b?.status as SyncRequestStatus | undefined
    error = b?.error
  }
  const now = new Date().toISOString()
  const cur = await readSyncRequest()

  // App (or CoS) pressing the button: open a request.
  if (!status || status === 'pending') {
    // A pending or running request untouched for STALE_MS is abandoned: a new press re-opens a fresh one.
    const stale = isSyncPending(cur) && Date.now() - Date.parse(cur.startedAt || cur.requestedAt || now) > STALE_MS
    if (isSyncPending(cur) && !stale) {
      const next: SyncRequest = { ...cur, presses: (cur.presses || 1) + 1 }
      await writeSyncRequest(next)
      return view(next)
    }
    const next: SyncRequest = { id: randomUUID(), status: 'pending', requestedAt: now, requestedBy: role, startedAt: null, completedAt: null, presses: 1 }
    await writeSyncRequest(next)
    return view(next)
  }

  // CoS acknowledgements.
  if (role !== 'sync') return err(403, 'status_not_allowed', { allowed: ['pending'] })
  if (!['running', 'done', 'failed'].includes(status)) return err(400, 'status_not_allowed', { allowed: ['pending', 'running', 'done', 'failed'] })
  if (cur.status === 'idle') return err(409, 'no_request')
  const next: SyncRequest = { ...cur, status }
  if (status === 'running') next.startedAt = now
  if (status === 'done' || status === 'failed') { next.completedAt = now; next.completedBy = 'ack'; next.startedAt = cur.startedAt || now }
  if (status === 'failed') next.error = String(error || 'sync failed').slice(0, 1000); else delete next.error
  await writeSyncRequest(next)
  return view(next)
}
