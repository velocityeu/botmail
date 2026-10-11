import { json, MAILBOX } from './_lib/http.js'
export function GET() {
  return json({ ok: true, mailbox: MAILBOX,
    configured: !!(process.env.BOTMAIL_APP_KEY && process.env.BOTMAIL_SYNC_SECRET),
    storage: process.env.BOTMAIL_MOCK === '1' ? 'mock' : process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'missing' })
}
