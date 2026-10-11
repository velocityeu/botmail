// Turns loosely-shaped thread snapshots (as CoS reads them from Grok Bot
// SearchEmailThreads / ReadEmailThread) into the strict ApiThread contract.
import type { ApiFolder, ApiMessage, ApiThread } from '../../shared/types.js'
import { MAILBOX } from './http.js'

const FOLDERS: ApiFolder[] = ['inbox', 'sent', 'archive', 'trash', 'drafts']
const MAX_BODY = 100_000
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max)

/** "Name <a@b.c>" | "a@b.c" | {name,email} -> {name, addr} */
export function parseAddr(v: unknown): { name: string; addr: string } {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const addr = str(o.email ?? o.address ?? o.addr).trim().toLowerCase()
    return { name: str(o.name).trim() || addr.split('@')[0] || 'Unknown', addr }
  }
  const s = str(v).trim()
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s)
  if (m) return { name: m[1].trim() || m[2].split('@')[0], addr: m[2].trim().toLowerCase() }
  return { name: s.split('@')[0] || 'Unknown', addr: s.toLowerCase() }
}

const listStr = (v: unknown) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])
  .map(x => { const a = parseAddr(x); return a.name && a.name !== a.addr.split('@')[0] ? `${a.name} <${a.addr}>` : a.addr })
  .filter(Boolean).join(', ')

function iso(v: unknown): string {
  const d = v ? new Date(str(v)) : new Date()
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

export function normMessage(raw: unknown, i: number, threadId: string): ApiMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const f = parseAddr(r.fromAddr ? { name: r.from, email: r.fromAddr } : (r.from ?? r.sender))
  const atts = Array.isArray(r.attachments) ? r.attachments.slice(0, 20).map(a => {
    const o = (a && typeof a === 'object' ? a : { name: a }) as Record<string, unknown>
    return { name: str(o.name ?? o.filename, 300) || 'attachment', ...(o.size != null ? { size: str(o.size, 40) } : {}) }
  }) : undefined
  return {
    id: str(r.id ?? r.messageId ?? r.message_id, 300) || `${threadId}#${i}`,
    from: f.name, fromAddr: f.addr,
    to: listStr(r.to), ...(r.cc ? { cc: listStr(r.cc) } : {}),
    date: iso(r.date ?? r.sentAt ?? r.receivedAt ?? r.timestamp),
    body: str(r.body ?? r.text ?? r.snippet, MAX_BODY),
    ...(r.bot ? { bot: true } : {}),
    ...(atts && atts.length ? { attachments: atts } : {}),
  }
}

export function normThread(raw: unknown): ApiThread | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id ?? r.threadId ?? r.thread_id, 300)
  if (!id) return null
  const messages = (Array.isArray(r.messages) ? r.messages : [])
    .map((m, i) => normMessage(m, i, id)).filter((m): m is ApiMessage => !!m)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!messages.length) return null
  const mine = (m: ApiMessage) => m.fromAddr === MAILBOX
  const folder = FOLDERS.includes(r.folder as ApiFolder) ? r.folder as ApiFolder : messages.every(mine) ? 'sent' : 'inbox'
  return {
    id, subject: str(r.subject, 500) || '(no subject)', folder,
    labels: Array.isArray(r.labels) ? r.labels.map(l => str(l, 40)).slice(0, 10) : [],
    ...(typeof r.unread === 'boolean' ? { unread: r.unread } : {}),
    ...(r.starred ? { starred: true } : {}),
    ...(r.bot || messages.some(m => m.bot) ? { bot: true } : {}),
    lastAt: messages[messages.length - 1].date,
    messages,
  }
}

/** Merge b into a: messages unioned by id (b wins), thread fields from b. */
export function mergeThread(a: ApiThread, b: ApiThread, explicitFolder = false): ApiThread {
  const byId = new Map(a.messages.map(m => [m.id, m]))
  for (const m of b.messages) byId.set(m.id, m)
  const messages = [...byId.values()].sort((x, y) => x.date.localeCompare(y.date))
  const folder = explicitFolder ? b.folder
    : (a.folder === 'inbox' || a.folder === 'sent') ? (messages.every(m => m.fromAddr === MAILBOX) ? 'sent' : 'inbox') : a.folder
  return { ...a, ...b, folder, labels: b.labels.length ? b.labels : a.labels, messages, lastAt: messages[messages.length - 1].date }
}
