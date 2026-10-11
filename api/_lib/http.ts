import { timingSafeEqual, createHash } from 'node:crypto'

export const MAILBOX = 'alexandertr@mail.grokbot.com'

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })
}

export const err = (status: number, error: string, more: Record<string, unknown> = {}) => json({ error, ...more }, status)

const isMock = () => process.env.BOTMAIL_MOCK === '1'

function safeEq(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

function bearer(req: Request) {
  const h = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : (req.headers.get('x-botmail-key') || '').trim()
}

export type Role = 'app' | 'sync'

/**
 * app  = the signed-in user of the web app (BOTMAIL_APP_KEY)
 * sync = the Chief-of-Staff agent that mirrors Grok Bot mail (BOTMAIL_SYNC_SECRET); sync can do everything app can.
 */
export function auth(req: Request, need: Role): Role | Response {
  const appKey = process.env.BOTMAIL_APP_KEY || (isMock() ? 'dev' : '')
  const syncKey = process.env.BOTMAIL_SYNC_SECRET || (isMock() ? 'dev-sync' : '')
  if (!appKey || !syncKey) return err(503, 'server_not_configured', { needs: 'BOTMAIL_APP_KEY and BOTMAIL_SYNC_SECRET env vars' })
  const k = bearer(req)
  if (!k) return err(401, 'missing_key')
  if (safeEq(k, syncKey)) return 'sync'
  if (need === 'app' && safeEq(k, appKey)) return 'app'
  return err(401, 'invalid_key')
}

export async function body<T = unknown>(req: Request, max = 2_000_000): Promise<T | Response> {
  const text = await req.text()
  if (text.length > max) return err(413, 'payload_too_large')
  try { return JSON.parse(text) as T } catch { return err(400, 'invalid_json') }
}

export const lastSegment = (req: Request) => decodeURIComponent(new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop() || '')
