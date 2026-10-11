// GET /api/threads  (app key)  -> { threads, syncedAt, mailbox }
import { auth, json, MAILBOX } from '../_lib/http.js'
import { readThreads } from '../_lib/store.js'

export async function GET(req: Request) {
  const a = auth(req, 'app'); if (a instanceof Response) return a
  const doc = await readThreads()
  const threads = [...doc.threads].sort((x, y) => y.lastAt.localeCompare(x.lastAt))
  return json({ threads, syncedAt: doc.syncedAt, mailbox: MAILBOX })
}
