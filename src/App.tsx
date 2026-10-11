import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ME, type Folder, type Label, type Message, type Thread } from './data'
import type { ApiThread, OutboundItem, OutboundStatus, SyncRequest } from '../shared/types'
import {
  ApiError, buildThreads, cancelSend, clearKey, fetchLive, fetchSyncRequest, firstAddr, flagsFrom, getKey, getMode, loadDemo, loadFlags,
  queueSend, requestSync, resetDemo, saveDemo, saveFlags, setDemoMode, setKey, timeLabel, type Flags,
} from './mailSource'
import { Icon } from './icons'

const FOLDERS: { id: Folder; name: string; icon: string }[] = [
  { id: 'inbox', name: 'Inbox', icon: 'inbox' },
  { id: 'starred', name: 'Starred', icon: 'star' },
  { id: 'sent', name: 'Sent', icon: 'sent' },
  { id: 'drafts', name: 'Drafts', icon: 'drafts' },
  { id: 'archive', name: 'Archive', icon: 'archive' },
  { id: 'trash', name: 'Trash', icon: 'trash' },
]
const LABELS: { id: Label; name: string; cls: string }[] = [
  { id: 'bots', name: 'Bots', cls: 'sw-patina' },
  { id: 'field', name: 'Field ops', cls: 'sw-bronze' },
  { id: 'builds', name: 'Builds', cls: 'sw-steel' },
  { id: 'calendar', name: 'Calendar', cls: 'sw-brass' },
]
type Seg = 'all' | 'unread' | 'bots'

const nowHM = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const nowLong = () => new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', ' ·')

function useClock(fmt: () => string) {
  const [t, setT] = useState(fmt)
  useEffect(() => { const i = setInterval(() => setT(fmt()), 15000); return () => clearInterval(i) }, [fmt])
  return t
}
function useWide() {
  const q = '(min-width: 900px)'
  const [w, setW] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => { const m = window.matchMedia(q); const f = () => setW(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return w
}

function Coin({ coin, initials, size = 34 }: { coin: string; initials: string; size?: number }) {
  return <div className={`av c-${coin}`} style={{ width: size, height: size, fontSize: size * 0.37 }}>{initials}</div>
}

export default function App() {
  const wide = useWide()
  const longClock = useClock(nowLong)
  const [mode, setMode] = useState<'loading' | 'connect' | 'live' | 'demo'>(() => getKey() ? 'loading' : getMode() === 'demo' ? 'demo' : 'connect')
  const [demoThreads, setDemoThreads] = useState<Thread[]>(() => getMode() === 'demo' ? loadDemo() : [])
  const [apiThreads, setApiThreads] = useState<ApiThread[]>([])
  const [outbound, setOutbound] = useState<OutboundItem[]>([])
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [flags, setFlags] = useState<Flags>(loadFlags)
  const [refreshing, setRefreshing] = useState(false)
  const [connectErr, setConnectErr] = useState<string | null>(null)
  const [folder, setFolder] = useState<Folder>('inbox')
  const [label, setLabel] = useState<Label | null>(null)
  const [seg, setSeg] = useState<Seg>('all')
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [composing, setComposing] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(false)
  const [syncReq, setSyncReq] = useState<SyncRequest | null>(null)
    const [requesting, setRequesting] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const live = mode === 'live'

  const threads = useMemo(() => live ? buildThreads(apiThreads, outbound, flags) : demoThreads, [live, apiThreads, outbound, flags, demoThreads])

  const refresh = useCallback(async (key?: string, quiet = false) => {
    if (!quiet) setRefreshing(true)
    try {
      const d = await fetchLive(key)
      if (key) setKey(key)
      setApiThreads(d.threads); setOutbound(d.outbound); setSyncedAt(d.syncedAt); if (d.syncRequest) setSyncReq(d.syncRequest)
      setMode('live'); setDemoMode(false); setConnectErr(null)
      return true
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 503)) {
        clearKey(); setMode('connect')
        setConnectErr(e.status === 401 ? 'That access key was not accepted.' : 'The server is not configured yet.')
      } else if (key || !quiet) { setConnectErr('Could not reach the mail API. Check your connection.'); if (key) setMode('connect') }
      return false
    } finally { if (!quiet) setRefreshing(false) }
  }, [])

  useEffect(() => { if (mode === 'loading') refresh(undefined, true).then(ok => { if (!ok && getKey()) setMode('live') }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // poll while visible
    if (!live) return
    const tick = () => { if (document.visibilityState === 'visible') refresh(undefined, true) }
    const i = setInterval(tick, 45000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', tick) }
  }, [live, refresh])
  // Sync button. The spinner is driven ONLY by local state for the current press (syncPhase), never by
  // the server's request status seen on a background poll, so it can never spin indefinitely.
  // After POST /api/sync-request we poll GET /api/sync-request every 3 s and stop as soon as the request
  // is done/failed, or the first successful poll reports pending=false, or a fresh syncedAt lands; then
  // reload threads. A hard 90 s timeout always stops the spinner and shows "Requested · tap Reload".
  const SYNC_POLL_MS = 3000, SYNC_TIMEOUT_MS = 90_000
  const [syncPhase, setSyncPhase] = useState<'idle' | 'watching' | 'timeout'>('idle')
  const [syncWatch, setSyncWatch] = useState<{ n: number; id: string | null; syncedAt: string | null } | null>(null)
  useEffect(() => {
    if (!live || !syncWatch) return
    let stop = false, inFlight = false
    const finish = (toast?: string) => {
      if (stop) return
      stop = true; clearInterval(i); clearTimeout(t)
      setSyncPhase('idle'); setSyncWatch(null)
      if (toast) setToast(toast)
      refresh(undefined, true)
    }
    const tick = async () => {
      if (stop || inFlight) return
      inFlight = true
      try {
        const r = await fetchSyncRequest()
        if (stop) return
        setSyncReq(r.request)
        const st = r.request.status
        const fresh = !!r.syncedAt && r.syncedAt !== syncWatch.syncedAt
        if (st === 'done' || (fresh && st !== 'failed')) finish('Synced')
        else if (st === 'failed') finish(`Sync failed${r.request.error ? ' · ' + r.request.error : ''}`)
        else if (!r.pending) finish()
      } catch { /* keep polling until the hard timeout */ }
      finally { inFlight = false }
    }
    const i = setInterval(tick, SYNC_POLL_MS)
    const t = setTimeout(() => {
      if (stop) return
      stop = true; clearInterval(i)
      setSyncPhase('timeout'); setSyncWatch(null)
    }, SYNC_TIMEOUT_MS)
    tick()
    return () => { stop = true; clearInterval(i); clearTimeout(t) }
  }, [live, syncWatch, refresh])
  const doSync = async () => {
    if (!live || requesting || syncPhase === 'watching') return
    setRequesting(true)
    try {
      const r = await requestSync()
      setSyncReq(r.request)
      setSyncPhase('watching')
      setSyncWatch({ n: Date.now(), id: r.request.id, syncedAt: r.syncedAt })
      setToast('Sync requested · Grok Bot will pick it up')
    } catch (e) { setToast(e instanceof ApiError ? `Sync not requested · ${e.message.replace(/_/g, ' ')}` : 'Sync not requested · network error') }
    finally { setRequesting(false) }
  }
  const reload = () => { setSyncPhase('idle'); refresh() }
  const syncBusy = requesting || syncPhase === 'watching'
  const syncLine = requesting ? 'Requesting…'
    : syncPhase === 'watching' ? (syncReq?.status === 'running' ? 'Grok Bot is syncing' : 'Waiting for Grok Bot')
    : syncPhase === 'timeout' ? 'Requested · tap Reload'
    : syncReq?.status === 'failed' && syncReq.completedAt && (!syncedAt || syncReq.completedAt > syncedAt) ? `Last sync failed${syncReq.error ? ' · ' + syncReq.error : ''}`
    : syncedAt ? `Last synced ${ago(syncedAt)}` : 'Idle · awaiting first sync'
  const syncTitle = syncBusy ? 'Sync requested; Grok Bot syncs mail and sends queued replies' : 'Ask Grok Bot to sync mail and send queued replies now'

  useEffect(() => { if (wide && !selId && threads[0]) setSelId(threads.find(t => t.folder === 'inbox')?.id ?? null) }, [threads.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'demo' && demoThreads.length) saveDemo(demoThreads) }, [mode, demoThreads])
  useEffect(() => { saveFlags(flags) }, [flags])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t) }, [toast])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'Escape') { setComposing(false); setRailOpen(false) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  // Sent is a view, not a home folder (Gmail-style): any non-trashed thread with a message from me
  // (synced or still in the outbound queue) shows there, as well as threads whose folder is 'sent'.
  const inFolder = (t: Thread, f: Folder) =>
    f === 'starred' ? !!t.starred && t.folder !== 'trash'
    : f === 'sent' ? t.folder === 'sent' || (t.folder !== 'trash' && t.messages.some(m => m.fromAddr === ME.addr || !!m.outboundId))
    : t.folder === f
  const visible = useMemo(() => threads.filter(t => {
    if (label ? !(t.labels.includes(label) && t.folder !== 'trash') : !inFolder(t, folder)) return false
    if (seg === 'unread' && !t.unread) return false
    if (seg === 'bots' && !t.bot) return false
    if (q) {
      const hay = (t.subject + ' ' + t.participants + ' ' + t.messages.map(m => m.from + ' ' + m.fromAddr + ' ' + m.body).join(' ')).toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  }), [threads, folder, label, seg, q])
  const sel = threads.find(t => t.id === selId) || null
  // Keep the reader bound to the list being viewed: on folder/label switch, if the open thread is not in
  // the new list, open the first one (wide) or clear the reader, instead of leaving a stale thread up.
  useEffect(() => {
    if (selId && visible.some(t => t.id === selId)) return
    setSelId(wide ? visible[0]?.id ?? null : null); setReply('')
  }, [folder, label]) // eslint-disable-line react-hooks/exhaustive-deps
  const unreadCount = threads.filter(t => t.folder === 'inbox' && t.unread).length
  const queuedCount = outbound.filter(o => o.status === 'queued' || o.status === 'sending').length
  const count = (f: Folder) => f === 'inbox' ? unreadCount : f === 'drafts' ? threads.filter(t => t.folder === 'drafts').length : f === 'sent' && live ? queuedCount : 0

  const update = (id: string, fn: (t: Thread) => Thread) => {
    if (!live) return setDemoThreads(ts => ts.map(t => t.id === id ? fn(t) : t))
    const prev = threads.find(t => t.id === id); if (!prev) return
    setFlags(f => flagsFrom(prev, fn(prev), apiThreads.find(a => a.id === id), f))
  }
  const open = (t: Thread) => { setSelId(t.id); if (t.unread) update(t.id, x => ({ ...x, unread: false })); setMobileView('thread'); setReply('') }
  const goFolder = (f: Folder) => { setFolder(f); setLabel(null); setRailOpen(false); setMobileView('list') }
  const goLabel = (l: Label) => { setLabel(l); setRailOpen(false); setMobileView('list') }
  const moveSel = (f: Folder, msg: string) => {
    if (!sel) return
    if (live && sel.id.startsWith('ob:')) return setToast('Not delivered yet · cancel it instead')
    update(sel.id, t => ({ ...t, folder: f })); setToast(msg)
    const next = visible.find(t => t.id !== sel.id)
    setSelId(wide && next ? next.id : null); setMobileView('list')
  }
  const lastInbound = (t: Thread) => [...t.messages].reverse().find(m => m.fromAddr !== ME.addr && !m.outboundId)
  const sendReply = async (text?: string) => {
    const body = (text ?? reply).trim()
    if (!sel || !body || sending) return
    const last = lastInbound(sel)
    if (!live) {
      const m: Message = { id: 'r' + Date.now(), from: ME.name, fromAddr: ME.addr, to: last?.from ?? sel.participants, time: nowHM(), coin: 'brass', initials: ME.initials, body }
      update(sel.id, t => ({ ...t, messages: [...t.messages, m], time: m.time, day: 'today' }))
      setReply(''); return setToast('Demo · saved on this device, not delivered')
    }
    const real = [...sel.messages].reverse().find(m => !m.outboundId)
    const to = last ? last.fromAddr : firstAddr(real?.to || '')
    if (!to) return setToast('No recipient address on this thread')
    setSending(true)
    try {
      const item = await queueSend({ to, subject: /^re:/i.test(sel.subject) ? sel.subject : 'Re: ' + sel.subject, body,
        replyToMessageId: (last ?? real)?.id, threadId: sel.id.startsWith('ob:') ? undefined : sel.id })
      setOutbound(o => [...o, item]); setReply(''); setToast('Queued · Grok Bot will deliver it')
    } catch (e) { setToast(e instanceof ApiError ? `Not queued · ${e.message}` : 'Not queued · network error') }
    finally { setSending(false) }
  }
  const sendNew = async (to: string, subject: string, body: string): Promise<boolean> => {
    if (!live) {
      const t: Thread = { id: 'n' + Date.now(), subject: subject || '(no subject)', participants: to || '(no recipient)', folder: 'sent', labels: [],
        unread: false, day: 'today', time: nowHM(), coin: 'brass', initials: ME.initials,
        messages: [{ id: 'nm' + Date.now(), from: ME.name, fromAddr: ME.addr, to: to, time: nowHM(), coin: 'brass', initials: ME.initials, body }] }
      setDemoThreads(ts => [t, ...ts]); setComposing(false); setToast('Demo · saved to Sent, not delivered'); return true
    }
    try {
      const item = await queueSend({ to, subject, body })
      setOutbound(o => [...o, item]); setComposing(false); setToast('Queued · Grok Bot will deliver it'); return true
    } catch (e) { setToast(e instanceof ApiError ? `Not queued · ${e.message.replace(/_/g, ' ')}` : 'Not queued · network error'); return false }
  }
  const cancel = async (id: string) => {
    try { const it = await cancelSend(id); setOutbound(o => o.map(x => x.id === id ? it : x)); setToast('Cancelled') }
    catch (e) { setToast(e instanceof ApiError && e.status === 409 ? 'Too late · already being sent' : 'Could not cancel') }
  }
  const startDemo = () => { setDemoMode(true); setDemoThreads(loadDemo()); setMode('demo') }
  const leave = () => { clearKey(); setDemoMode(false); setApiThreads([]); setOutbound([]); setSelId(null); setMode('connect') }
  const doResetDemo = () => { resetDemo(); setDemoThreads(loadDemo()) }
  const title = label ? LABELS.find(l => l.id === label)!.name : FOLDERS.find(f => f.id === folder)!.name
  const replyTo = sel ? (lastInbound(sel)?.from ?? sel.participants) : ''

  /* ---------- pieces ---------- */
  const rail = (
    <aside className={`rail ${railOpen ? 'open' : ''}`} aria-label="Mailboxes">
      <div className="brand"><div className="medal">G</div><div><b className="goldtxt">Grok Bot Mail</b><small>EST. MMXXVI</small></div>
        {!wide && <button className="knob steel close" onClick={() => setRailOpen(false)} aria-label="Close"><Icon n="x" s={14} /></button>}</div>
      <button className="compose-wide brass" onClick={() => { setComposing(true); setRailOpen(false) }}><Icon n="compose" s={16} />Compose</button>
      <nav className="nav">
        {FOLDERS.map(f => (
          <button key={f.id} className={`ni ${!label && folder === f.id ? 'on brass' : ''}`} onClick={() => goFolder(f.id)}>
            <Icon n={f.icon} s={16} />{f.name}{count(f.id) > 0 && <span className="c">{count(f.id)}</span>}
          </button>))}
      </nav>
      <div className="sec">LABELS</div>
      <nav className="nav">
        {LABELS.map(l => (
          <button key={l.id} className={`ni ${label === l.id ? 'on brass' : ''}`} onClick={() => goLabel(l.id)}>
            <span className={`lb ${l.cls}`} />{l.name}
          </button>))}
      </nav>
      <div className="acct"><Coin coin="brass" initials="AT" size={34} /><div style={{ minWidth: 0 }}><b>{ME.name}</b><small className="trunc"><i />{ME.addr}</small></div></div>
      {live ? <div className="demo live">
          <div className="syncbox">
            <button className={`syncb steel ${syncBusy ? 'busy' : ''}`} onClick={doSync} disabled={syncBusy} title={syncTitle} aria-live="polite">
              <span className="rv" /><Icon n="sync" s={15} w={2.4} /><b>{syncBusy ? 'Syncing…' : 'Sync'}</b><span className="rv" /></button>
            <span className="ls"><i className={syncBusy || refreshing ? 'spin' : ''} />{syncLine}</span>
          </div>
          {queuedCount > 0 && <span className="lq">{queuedCount} waiting to send</span>}
          <span><button onClick={reload}>Reload</button> · <button onClick={leave}>Disconnect</button></span>
        </div>
        : <div className="demo">Sample data · <button onClick={doResetDemo}>Reset</button> · <button onClick={leave}>Connect</button></div>}
    </aside>
  )

  const list = (
    <section className="lbz bezel" aria-label={title}>
      <div className="list parch">
        <div className="lhead">
          <div className="lt">
            {!wide && <button className="knob steel" onClick={() => setRailOpen(true)} aria-label="Mailboxes"><Icon n="sidebar" s={15} /></button>}
            <h1>{title}</h1>{!label && folder === 'inbox' && unreadCount > 0 && <span className="plate brass n">{unreadCount} NEW</span>}
            {!wide && live && <button className={`knob steel synck ${syncBusy ? 'busy' : ''}`} onClick={doSync} disabled={syncBusy} title={`${syncTitle} · ${syncLine}`} aria-label={syncBusy ? 'Syncing' : 'Sync'}><Icon n="sync" s={15} w={2.4} /></button>}
            {wide ? <div className="seg">{(['all', 'unread', 'bots'] as Seg[]).map(s => <button key={s} className={seg === s ? 'on brass' : ''} onClick={() => setSeg(s)}>{s === 'all' ? 'All' : s === 'unread' ? 'Unread' : 'Bots'}</button>)}</div>
              : <button className="compose-pill brass" onClick={() => setComposing(true)}><Icon n="compose" s={15} />Compose</button>}
          </div>
          <label className="search"><Icon n="search" s={15} c="#9A876E" w={2.4} />
            <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search mail" aria-label="Search mail" />
            {wide && <kbd>⌘K</kbd>}</label>
          {!wide && <div className="seg mseg">{(['all', 'unread', 'bots'] as Seg[]).map(s => <button key={s} className={seg === s ? 'on brass' : ''} onClick={() => setSeg(s)}>{s === 'all' ? 'All' : s === 'unread' ? `Unread${unreadCount ? ' ' + unreadCount : ''}` : 'Bots'}</button>)}</div>}
        </div>
        <div className="rows">
          {visible.length === 0 && <div className="empty"><div className="medal sm">∅</div>Nothing here{q ? ` for “${q}”` : ''}.</div>}
          {(['today', 'earlier'] as const).map(day => {
            const rows = visible.filter(t => t.day === day)
            if (!rows.length) return null
            return <div key={day}>
              <div className="day">{day.toUpperCase()}</div>
              {rows.map(t => {
                const last = t.messages[t.messages.length - 1]
                return <button key={t.id} className={`row ${t.unread ? '' : 'read'} ${t.id === selId && (wide || mobileView === 'thread') ? 'sel' : ''}`} onClick={() => open(t)}>
                  <div className="lead">{t.unread && <span className="rivet" aria-label="unread" />}</div>
                  <Coin coin={t.coin} initials={t.initials} size={36} />
                  <div className="b">
                    <div className="l1"><span className="from trunc">{t.participants}{t.messages.length > 1 && <span className="cnt"> {t.messages.length}</span>}</span>
                      {t.bot && <span className="tag">BOT</span>}{t.starred && <span className="st">★</span>}<span className="time">{t.time}</span></div>
                    <div className="s trunc">{t.subject}</div>
                    <div className="p">{last.body}</div>
                    {t.labels.filter(l => l !== 'bots').length > 0 && <div className="mini">{t.labels.filter(l => l !== 'bots').map(l => <span key={l} className={`mini-${l}`}>{LABELS.find(x => x.id === l)!.name.toUpperCase()}</span>)}</div>}
                  </div>
                </button>
              })}
            </div>
          })}
        </div>
      </div>
    </section>
  )

  const reader = sel ? (
    <section className="rbz bezel" aria-label="Message">
      <div className="reader">
        <div className="rbar">
          {!wide && <button className="chip act steel" onClick={() => setMobileView('list')}><Icon n="back" s={14} w={2.6} />{title}</button>}
          {wide && <>
            <button className="chip act steel" onClick={() => moveSel('archive', 'Archived')}><Icon n="archive" s={14} />Archive</button>
            <button className="chip act steel" onClick={() => { update(sel.id, t => ({ ...t, unread: true })); setToast('Marked unread') }}><Icon n="unread" s={14} />Mark unread</button>
            <button className="chip act steel" onClick={() => moveSel('inbox', 'Moved to Inbox')}><Icon n="inbox" s={14} />Move to Inbox</button>
          </>}
          <span className="flex" />
          {!wide && <button className="knob steel" onClick={() => moveSel('archive', 'Archived')} aria-label="Archive"><Icon n="archive" s={14} /></button>}
          <button className={`knob steel ${sel.starred ? 'lit' : ''}`} onClick={() => update(sel.id, t => ({ ...t, starred: !t.starred }))} aria-label="Star"><Icon n="star" s={14} /></button>
          <button className="knob steel" onClick={() => moveSel('trash', 'Moved to Trash')} aria-label="Delete"><Icon n="trash" s={14} /></button>
          {wide && <span className="clock">{longClock}</span>}
        </div>
        <div className="rscroll" key={sel.id}>
          <div className="rsub"><h2>{sel.subject}</h2>
            <div className="meta"><span className="plate brass">{sel.folder.toUpperCase()}</span>{sel.bot && <span className="plate patina">BOT REPLY</span>}<span className="plate outline">{sel.messages.length} MESSAGE{sel.messages.length > 1 ? 'S' : ''}</span></div></div>
          <div className="msgs">
            {sel.messages.map((m, i) => (
              <article key={m.id} className="mbz bezel"><div className={`msg ${m.bot ? 'bot' : ''} ${m.fromAddr === ME.addr ? 'mine' : ''}`}>
                <div className="mh"><Coin coin={m.coin} initials={m.initials} size={36} />
                  <div style={{ minWidth: 0 }}><div className="who">{m.from}<small>{m.bot ? 'bot reply' : m.fromAddr}</small></div><div className="to trunc">to {m.to}</div></div>
                  <div className="mt">{m.time}</div></div>
                {m.status && <div className="ostat"><span className={`plate ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span><span className="oh">{m.error || STATUS[m.status].hint}</span>
                  {m.status === 'queued' && m.outboundId && <button className="chip" onClick={() => cancel(m.outboundId!)}>Cancel</button>}</div>}
                <div className="txt">{m.body.split('\n').map((line, k) => <p key={k}>{line || '\u00a0'}</p>)}</div>
                {m.attachments?.map((a, k) => <span key={k} className="att" title="Attachment files stay in the Grok Bot inbox"><i /><Icon n="file" s={15} c="#7A5C2E" />{a.name}{a.size && <span>· {a.size}</span>}</span>)}
                {m.bot && i === sel.messages.length - 1 && <div className="quick">
                  {['Thanks!', 'Sounds good'].map(x => <button key={x} className="chip" onClick={() => setReply(x)}>{x}</button>)}</div>}
              </div></article>))}
          </div>
        </div>
        <form className="rpz bezel" onSubmit={e => { e.preventDefault(); sendReply() }}><div className="reply">
          <div className="ta"><Icon n="reply" s={14} c="#B08D57" w={2.4} />Reply to <span className="chip patina">{replyTo}</span>{wide && <> from <b>{ME.addr}</b></>}</div>
          <div className="rrow">
            <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder={`Reply to ${replyTo}…`} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply() } }} />
            <button type="submit" className={wide ? 'chip send brass' : 'sendknob brass'} disabled={!reply.trim() || sending} aria-label="Send">{wide ? <><Icon n="sent" s={14} w={2.4} />Send</> : <Icon n="up" s={16} w={2.6} />}</button>
          </div>
        </div></form>
      </div>
    </section>
  ) : (
    <section className="rbz bezel"><div className="reader empty-reader"><div className="medal">G</div><p>Select a conversation</p><small>{ME.addr}</small></div></section>
  )

  if (mode === 'connect' || mode === 'loading') return <Connect loading={mode === 'loading' || refreshing} error={connectErr} onConnect={k => refresh(k)} onDemo={startDemo} />

  return (
    <div className={`app ${wide ? 'wide' : 'narrow'} view-${mobileView}`}>
      <div className="bg" />
      {wide && <div className="lights" aria-hidden><i /><i /><i /></div>}
      {!wide && <div className="topline"><span className="acctline"><i />{ME.addr}</span></div>}
      <div className="panes">
        {(wide || railOpen) && rail}
        {!wide && railOpen && <div className="scrim" onClick={() => setRailOpen(false)} />}
        {(wide || mobileView === 'list') && list}
        {(wide || mobileView === 'thread') && reader}
      </div>
      {composing && <Compose onClose={() => setComposing(false)} onSend={sendNew} wide={wide} live={live} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function Compose({ onClose, onSend, wide, live }: { onClose: () => void; onSend: (to: string, s: string, b: string) => Promise<boolean>; wide: boolean; live: boolean }) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = /^\s*[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+\s*([,;]\s*[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+\s*)*$/.test(to) && !!body.trim()
  const submit = async () => { if (!ok || busy) return; setBusy(true); try { await onSend(to, subject, body) } finally { setBusy(false) } }
  return (
    <div className="cwrap" onClick={onClose}>
      <form className={`sheetb bezel ${wide ? 'win' : ''}`} onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="sheet parch">
          {!wide && <div className="grab" />}
          <div className="bar"><button type="button" className="x" onClick={onClose}>Cancel</button><h2>New message</h2>
            <span className="sendw"><button type="submit" className="chip brass sendc" disabled={!ok || busy}><Icon n="sent" s={14} w={2.4} />{busy ? 'Queuing…' : 'Send'}</button></span></div>
          <div className="f"><span className="k">FROM</span><span className="chip lock"><Icon n="lock" s={12} c="#EAF3EC" w={2.6} />{ME.addr}</span></div>
          <label className="f"><span className="k">TO</span><input value={to} onChange={e => setTo(e.target.value)} placeholder="name@example.com" autoFocus={wide} inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
          <label className="f"><span className="k">SUBJECT</span><input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={{ fontWeight: 650 }} /></label>
          <textarea className="cbody" value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message…"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
          <div className="tb">
            <span className="tbn">Plain text · separate recipients with commas</span>
            <button type="button" className="chip polish brass" onClick={() => setBody(b => b.trim() ? b.trim() + '\n\nBest,\nAlexander' : 'Hi —\n\n')}><Icon n="spark" s={13} c="#3A2810" />Add sign-off</button>
          </div>
          <p className="note">{live ? 'Queued, then sent from your Grok Bot address when your agent drains the queue. Status shows in Sent.' : 'Demo mode: saved on this device only. Nothing is delivered.'}</p>
        </div>
      </form>
    </div>
  )
}

const STATUS: Record<OutboundStatus, { label: string; cls: string; hint: string }> = {
  queued: { label: 'QUEUED', cls: 'outline', hint: 'Waiting for Grok Bot to send' },
  sending: { label: 'SENDING', cls: 'brass', hint: 'Grok Bot is sending this now' },
  sent: { label: 'SENT', cls: 'patina', hint: 'Delivered from ' + ME.addr },
  failed: { label: 'FAILED', cls: 'rust', hint: 'Not delivered' },
  cancelled: { label: 'CANCELLED', cls: 'outline', hint: 'Cancelled before sending' },
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return timeLabel(iso, true)
}

function Connect({ loading, error, onConnect, onDemo }: { loading: boolean; error: string | null; onConnect: (k: string) => void; onDemo: () => void }) {
  const [k, setK] = useState('')
  return (
    <div className="app connect">
      <div className="bg" />
      <form className="cnb bezel" onSubmit={e => { e.preventDefault(); if (k.trim()) onConnect(k.trim()) }}>
        <div className="cn parch">
          <div className="medal">G</div>
          <h1 className="goldtxt">Grok Bot Mail</h1>
          <p className="cna">{ME.addr}</p>
          {loading && !k ? <p className="cnh">Opening your mailbox…</p> : <>
            <label className="cnk"><span>ACCESS KEY</span>
              <input type="password" value={k} onChange={e => setK(e.target.value)} placeholder="Paste your access key" autoFocus autoComplete="current-password" /></label>
            {error && <p className="cne" role="alert">{error}</p>}
            <button type="submit" className="chip brass cnc" disabled={!k.trim() || loading}>{loading ? 'Connecting…' : 'Open mailbox'}</button>
            <p className="cnh">Ask your Grok Bot agent for the mailbox access key (<b>BOTMAIL_APP_KEY</b>). It is saved on this device only.</p>
            <button type="button" className="cnd" onClick={onDemo}>Explore with sample data</button>
          </>}
        </div>
      </form>
    </div>
  )
}
