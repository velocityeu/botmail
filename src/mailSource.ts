import { SAMPLE_THREADS, type Thread } from './data'

const API = import.meta.env.VITE_MAIL_API as string | undefined
const KEY = 'botmail.v1.local'

/** Load threads: optional read-only API (no secrets in the client), else baked sample data. */
export async function loadThreads(): Promise<{ threads: Thread[]; source: 'api' | 'sample' }> {
  if (API) {
    try {
      const r = await fetch(API, { credentials: 'include' })
      if (r.ok) {
        const j = await r.json()
        if (Array.isArray(j.threads)) return { threads: j.threads, source: 'api' }
      }
    } catch { /* fall through to sample */ }
  }
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) return { threads: JSON.parse(saved), source: 'sample' }
  } catch { /* ignore */ }
  return { threads: structuredClone(SAMPLE_THREADS), source: 'sample' }
}

export function saveLocal(threads: Thread[]) {
  try { localStorage.setItem(KEY, JSON.stringify(threads)) } catch { /* ignore */ }
}

export function resetLocal() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
