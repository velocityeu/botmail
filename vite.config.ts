import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Local dev: serve the real Vercel handlers in api/ from the Vite dev server,
 * backed by a file store in .mock-store/ (BOTMAIL_MOCK=1).
 * Dev keys: app = "dev", sync = "dev-sync".
 */
function devApi(): Plugin {
  const routes: [RegExp, string][] = [
    [/^\/api\/threads\/?$/, '/api/threads/index.ts'],
    [/^\/api\/threads\/[^/]+$/, '/api/threads/[id].ts'],
    [/^\/api\/outbound\/?$/, '/api/outbound/index.ts'],
    [/^\/api\/outbound\/[^/]+$/, '/api/outbound/[id].ts'],
    [/^\/api\/(sync-request|wake-sync|sync|send|health)\/?$/, '/api/$1.ts'],
  ]
  return {
    name: 'botmail-dev-api',
    apply: 'serve',
    async configureServer(server: ViteDevServer) {
      process.env.BOTMAIL_MOCK = '1'
      if (!existsSync('.mock-store/threads.json')) {
        const { normThread } = await server.ssrLoadModule('/api/_lib/normalize.ts')
        const snap = JSON.parse(readFileSync('scripts/sample-snapshot.json', 'utf8'))
        mkdirSync('.mock-store', { recursive: true })
        writeFileSync('.mock-store/threads.json', JSON.stringify({ threads: snap.threads.map(normThread).filter(Boolean), syncedAt: new Date().toISOString() }))
      }
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url || '/', 'http://localhost')
        const hit = routes.find(([re]) => re.test(url.pathname))
        if (!hit) return next()
        const file = url.pathname.replace(hit[0], hit[1])
        try {
          const mod = await server.ssrLoadModule(file)
          const fn = mod[req.method || 'GET']
          if (!fn) { res.statusCode = 405; return res.end('{"error":"method_not_allowed"}') }
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          const r: Response = await fn(new Request(url, { method: req.method, headers, body: chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined }))
          res.statusCode = r.status
          r.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await r.arrayBuffer()))
        } catch (e) {
          console.error(e); res.statusCode = 500; res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

export default defineConfig({ plugins: [react(), devApi()] })
