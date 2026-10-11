// Persistence: two JSON documents in a PRIVATE Vercel Blob store.
//   botmail/threads.json  -> { threads, syncedAt }   (written only by /api/sync)
//   botmail/outbound.json -> { items }               (queue; app enqueues, CoS acks)
// Local dev (BOTMAIL_MOCK=1) uses .mock-store/*.json instead.
import { get, put } from '@vercel/blob'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ApiThread, OutboundItem } from '../../shared/types.js'

export interface ThreadsDoc { threads: ApiThread[]; syncedAt: string | null }
export interface OutboundDoc { items: OutboundItem[] }

const mock = () => process.env.BOTMAIL_MOCK === '1'
const MOCK_DIR = path.join(process.cwd(), '.mock-store')

async function readDoc<T>(name: string, fallback: T): Promise<T> {
  if (mock()) {
    try { return JSON.parse(await fs.readFile(path.join(MOCK_DIR, name), 'utf8')) as T } catch { return fallback }
  }
  const r = await get(`botmail/${name}`, { access: 'private', useCache: false })
  if (!r || r.statusCode !== 200 || !r.stream) return fallback
  const text = await new Response(r.stream).text()
  try { return JSON.parse(text) as T } catch { return fallback }
}

async function writeDoc(name: string, doc: unknown) {
  const text = JSON.stringify(doc)
  if (mock()) {
    await fs.mkdir(MOCK_DIR, { recursive: true })
    await fs.writeFile(path.join(MOCK_DIR, name), text)
    return
  }
  await put(`botmail/${name}`, text, {
    access: 'private', allowOverwrite: true, addRandomSuffix: false,
    contentType: 'application/json', cacheControlMaxAge: 60,
  })
}

export const readThreads = () => readDoc<ThreadsDoc>('threads.json', { threads: [], syncedAt: null })
export const writeThreads = (d: ThreadsDoc) => writeDoc('threads.json', d)
export const readOutbound = () => readDoc<OutboundDoc>('outbound.json', { items: [] })
export const writeOutbound = (d: OutboundDoc) => writeDoc('outbound.json', d)
