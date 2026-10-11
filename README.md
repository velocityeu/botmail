# Bot Mail: Grok Bot inbox UI (v1)

A static Vite + React app for `alexandertr@mail.grokbot.com`, in the locked metal style (brass, steel, bronze, cream parchment, patina for bots only).

- **Data:** v1 uses sample threads baked into `src/data.ts`. Compose, reply, archive, star and delete all work locally and persist to `localStorage`. **Nothing is delivered**, and the UI says so. "Reset" in the sidebar restores the sample data.
- **Wiring later:** set `VITE_MAIL_API` to a read endpoint that returns `{ threads: Thread[] }`. The `Thread` shape is in `src/data.ts`, and the loader is `src/mailSource.ts`. The client holds no keys. Put auth behind your own server or session.
- **Responsive:**
  - At 900px and wider: three panes (sidebar, list, reader).
  - Below 900px: a single-pane phone flow with a drawer sidebar and a bottom-sheet compose. The phone layout respects iOS safe areas.
  - The app can be installed as a PWA.
- **Mock framing:** `?frame=ios` and `?frame=mac` are used only by the mock renderer.

```bash
npm install
npm run dev      # local
npm run build    # -> dist/
```
Deploy target: Vercel project `botmail`, domain `botmail.velocitypulse.io`.
