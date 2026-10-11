// POST /api/wake-sync  (app or sync key) -> wake the Chief-of-Staff agent now.
//
// Server-side proxy for the Cursor automation webhook (browser -> api2.cursor.sh is CORS-blocked and the
// webhook token must never reach the client). The app calls this fire-and-forget right after
// POST /api/sync-request has recorded the pending request, so CoS wakes, sees the pending request and syncs.
//
// Env (server only, never VITE_):
//   BOTMAIL_SYNC_WEBHOOK_URL    Cursor automation webhook URL
//   BOTMAIL_SYNC_WEBHOOK_TOKEN  bearer token for that webhook
//
// Throttled: at most one wake per WAKE_MIN_MS per open request (extra presses only bump `presses`).
import { auth, err, json } from './_lib/http.js'
import { isSyncPending, readSyncRequest, writeSyncRequest } from './_lib/store.js'

const WAKE_MIN_MS = 60_000
const TIMEOUT_MS = 10_000

export async function POST(req: Request) {
  const role = auth(req, 'app'); if (role instanceof Response) return role
  const url = process.env.BOTMAIL_SYNC_WEBHOOK_URL
  const token = process.env.BOTMAIL_SYNC_WEBHOOK_TOKEN
  if (!url || !token) return err(503, 'wake_not_configured', { needs: 'BOTMAIL_SYNC_WEBHOOK_URL and BOTMAIL_SYNC_WEBHOOK_TOKEN env vars' })

  const cur = await readSyncRequest()
  if (!isSyncPending(cur)) return json({ ok: true, woke: false, reason: 'no_pending_request', request: cur })
  if (cur.wokeAt && Date.now() - Date.parse(cur.wokeAt) < WAKE_MIN_MS) return json({ ok: true, woke: false, reason: 'recently_woken', wokeAt: cur.wokeAt })

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
  let status = 0
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      // The webhook-started routine run has no Grok Bot mail tools; the PARENT CoS must do the pull on this wake.
      body: JSON.stringify({ source: 'botmail-sync-button', requestId: cur.id, action: 'pull-and-flush',
        note: 'AT tapped Sync. Parent CoS (with SearchEmailThreads/ReadEmailThread/SendEmail) must pull the inbox, POST /api/sync?source=cos-pull, flush the outbound queue, then sync-done.' }),
    })
    status = r.status
  } catch (e) {
    return err(502, 'wake_unreachable', { detail: ac.signal.aborted ? 'timeout' : String((e as Error)?.message || e).slice(0, 200) })
  } finally { clearTimeout(t) }

  if (status < 200 || status >= 300) return err(502, 'wake_rejected', { upstreamStatus: status })
  const wokeAt = new Date().toISOString()
  // Re-read so we don't clobber a concurrent CoS claim.
  const latest = await readSyncRequest()
  if (latest.id === cur.id) await writeSyncRequest({ ...latest, wokeAt, wakes: (latest.wakes || 0) + 1 })
  return json({ ok: true, woke: true, upstreamStatus: status, wokeAt })
}
