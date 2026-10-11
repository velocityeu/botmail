import { ME, SAMPLE_THREADS, type Coin, type Folder, type Label, type Message, type Thread } from './data'
import type { ApiMessage, ApiThread, OutboundItem, OutboundResponse, SyncRequest, SyncRequestResponse, ThreadsResponse } from '../shared/types'

/* ---------------- key + local prefs ---------------- */
const K_KEY = 'botmail.key'
const K_DEMO = 'botmail.v1.local'
const K_MODE = 'botmail.mode'
const K_FLAGS = 'botmail.flags'

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
  del: (k: string) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}
export const getKey = () => ls.get(K_KEY)
export const setKey = (k: string) => ls.set(K_KEY, k.trim())
export const clearKey = () => ls.del(K_KEY)
export const getMode = () => ls.get(K_MODE) as 'demo' | null
export const setDemoMode = (on: boolean) => on ? ls.set(K_MODE, 'demo') : ls.del(K_MODE)

/* ---------------- API client ---------------- */
export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }

async function api<T>(path: string, init: RequestInit = {}, key = getKey()): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${key ?? ''}`, ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(r.status, (j as { error?: string }).error || `HTTP ${r.status}`)
  return j as T
}

export async function fetchLive(key?: string) {
  const [t, o] = await Promise.all([
    api<ThreadsResponse>('/api/threads', {}, key),
    api<OutboundResponse>('/api/outbound', {}, key),
  ])
  return { threads: t.threads, syncedAt: t.syncedAt, outbound: o.items, syncRequest: t.syncRequest ?? null }
}
export const requestSync = () => api<SyncRequestResponse>('/api/sync-request', { method: 'POST', body: '{}' })
export const fetchSyncRequest = () => api<SyncRequestResponse>('/api/sync-request')
export type { SyncRequest }
export const queueSend = (m: { to: string; subject: string; body: string; replyToMessageId?: string; threadId?: string; cc?: string }) =>
  api<{ item: OutboundItem }>('/api/outbound', { method: 'POST', body: JSON.stringify(m) }).then(r => r.item)
export const cancelSend = (id: string) =>
  api<{ item: OutboundItem }>(`/api/outbound/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ status: 'cancelled' }) }).then(r => r.item)

/* ---------------- per-device flags (read / star / folder) ---------------- */
export interface Flag { read?: string; starred?: boolean; folder?: Folder; folderAt?: string }
export type Flags = Record<string, Flag>
export const loadFlags = (): Flags => { try { return JSON.parse(ls.get(K_FLAGS) || '{}') } catch { return {} } }
export const saveFlags = (f: Flags) => ls.set(K_FLAGS, JSON.stringify(f))

/* ---------------- demo mode ---------------- */
export function loadDemo(): Thread[] {
  try { const s = ls.get(K_DEMO); if (s) return JSON.parse(s) } catch { /* ignore */ }
  return structuredClone(SAMPLE_THREADS)
}
export const saveDemo = (t: Thread[]) => ls.set(K_DEMO, JSON.stringify(t))
export const resetDemo = () => ls.del(K_DEMO)

/* ---------------- API -> view model ---------------- */
const TZ = 'Europe/London'
const COINS: Coin[] = ['patina', 'bronze', 'steel', 'gold']
const LABELS: Label[] = ['bots', 'field', 'builds', 'calendar']
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const coinFor = (addr: string): Coin => addr === ME.addr ? 'brass' : COINS[[...addr].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COINS.length]
export const initialsOf = (name: string) => (name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase()
export const firstAddr = (s: string) => (/[^\s<>,;"]+@[^\s<>,;"]+/.exec(s) || [''])[0].toLowerCase()

export function timeLabel(iso: string, long = false) {
  const d = new Date(iso), now = new Date()
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  if (dayKey(d) === dayKey(now)) return hm
  const days = (now.getTime() - d.getTime()) / 864e5
  const date = days < 6 ? d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ })
  return long ? `${date} ${hm}` : date
}

function msgVm(m: ApiMessage): Message {
  const mine = m.fromAddr === ME.addr
  return { id: m.id, from: mine ? ME.name : m.from, fromAddr: m.fromAddr, to: m.to, time: timeLabel(m.date, true),
    coin: coinFor(m.fromAddr), initials: mine ? ME.initials : initialsOf(m.from), bot: m.bot, body: m.body, attachments: m.attachments }
}
function outVm(o: OutboundItem): Message {
  return { id: 'ob:' + o.id, outboundId: o.id, status: o.status, error: o.error, from: ME.name, fromAddr: ME.addr,
    to: [...o.to, ...(o.cc || [])].join(', '), time: timeLabel(o.createdAt, true), coin: 'brass', initials: ME.initials, body: o.body }
}

export function buildThreads(apiThreads: ApiThread[], outbound: OutboundItem[], flags: Flags): Thread[] {
  const seen = new Set(apiThreads.flatMap(t => t.messages.map(m => m.id)))
  const pending = outbound.filter(o => o.status !== 'cancelled' && !(o.messageId && seen.has(o.messageId)))
  const today = dayKey(new Date())
  const out: Thread[] = apiThreads.map(t => {
    const msgs = t.messages.map(msgVm)
    let ts = Date.parse(t.lastAt)
    for (const o of pending.filter(o => o.threadId === t.id || (o.replyToMessageId && t.messages.some(m => m.id === o.replyToMessageId)))) {
      msgs.push(outVm(o)); ts = Math.max(ts, Date.parse(o.createdAt))
    }
    const inbound = t.messages.filter(m => m.fromAddr !== ME.addr)
    const lastIn = inbound[inbound.length - 1]
    const lastMsg = t.messages[t.messages.length - 1]
    const f = flags[t.id] || {}
    const names = [...new Set(inbound.map(m => m.from))]
    const participants = names.length ? names.join(', ') : (lastMsg.to || '(no recipient)')
    const lead = lastIn ?? lastMsg
    const folder: Folder = f.folder && f.folderAt === lastMsg.id ? f.folder : t.folder
    return {
      id: t.id, subject: t.subject, participants, folder,
      labels: t.labels.filter((l): l is Label => LABELS.includes(l as Label)),
      unread: !!lastIn && f.read !== lastIn.id && t.unread !== false,
      starred: f.starred ?? t.starred, bot: t.bot,
      day: dayKey(new Date(ts)) === today ? 'today' : 'earlier', time: timeLabel(new Date(ts).toISOString()),
      coin: lastIn ? coinFor(lead.fromAddr) : 'brass', initials: lastIn ? initialsOf(lead.from) : initialsOf(participants),
      messages: msgs, ts,
    }
  })
  for (const o of pending.filter(o => !out.some(t => t.messages.some(m => m.outboundId === o.id)))) {
    const ts = Date.parse(o.createdAt)
    out.push({ id: 'ob:' + o.id, subject: o.subject, participants: o.to.join(', '), folder: 'sent', labels: [], unread: false,
      day: dayKey(new Date(ts)) === today ? 'today' : 'earlier', time: timeLabel(o.createdAt), coin: 'brass', initials: initialsOf(o.to[0] || '?'),
      messages: [outVm(o)], ts })
  }
  return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
}

/** Diff an edited view-model thread back into device flags. */
export function flagsFrom(prev: Thread, next: Thread, apiThread: ApiThread | undefined, flags: Flags): Flags {
  if (!apiThread) return flags
  const f: Flag = { ...(flags[prev.id] || {}) }
  const inbound = apiThread.messages.filter(m => m.fromAddr !== ME.addr)
  const lastIn = inbound[inbound.length - 1]
  if (prev.unread !== next.unread) { if (next.unread) delete f.read; else if (lastIn) f.read = lastIn.id }
  if (!!prev.starred !== !!next.starred) f.starred = !!next.starred
  if (prev.folder !== next.folder) { f.folder = next.folder; f.folderAt = apiThread.messages[apiThread.messages.length - 1].id }
  return { ...flags, [prev.id]: f }
}
