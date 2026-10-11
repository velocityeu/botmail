# Bot Mail

Metal-style Grok Bot inbox UI — Vite + React + TypeScript.

**Live:** https://botmail.velocitypulse.io

## Status

- **Web (this repo):** deployed and ready for verification at the live URL above.
- **iOS / macOS native shells:** ON HOLD until the web app is verified.
- **Data:** mock / sample threads only (`src/data.ts`). Compose, reply, archive, star, and delete work locally and persist to `localStorage`. **Nothing is delivered** — there is no mail API yet. "Reset" in the sidebar restores sample data.

## Setup

```bash
npm install
npm run dev      # local
npm run build    # -> dist/
```

Optional later wiring: set `VITE_MAIL_API` to a read endpoint that returns `{ threads: Thread[] }`. The `Thread` shape is in `src/data.ts`; the loader is `src/mailSource.ts`. The client holds no keys — put auth behind your own server or session.

## Layout

- ≥900px: three panes (sidebar, list, reader)
- &lt;900px: single-pane phone flow with drawer sidebar and bottom-sheet compose (iOS safe areas)
- Installable as a PWA
- `?frame=ios` / `?frame=mac` are mock-renderer helpers only

## Deploy

Vercel project `botmail`, domain `botmail.velocitypulse.io`.
