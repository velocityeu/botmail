// GET /api/threads/:id  (app key)  -> { thread }
import { auth, err, json, lastSegment } from '../_lib/http.js'
import { readThreads } from '../_lib/store.js'

export async function GET(req: Request) {
  const a = auth(req, 'app'); if (a instanceof Response) return a
  const id = lastSegment(req)
  const t = (await readThreads()).threads.find(x => x.id === id)
  return t ? json({ thread: t }) : err(404, 'not_found')
}
