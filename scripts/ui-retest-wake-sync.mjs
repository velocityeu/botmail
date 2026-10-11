// iPhone Chrome UA retest of the "Sync = wake" UX. Connect → Sync → sample status line to 120 s → Reload.
// Pass: spinner gone within 35 s, and by 120 s the line is "Last synced …" (fresh) OR "… tap Reload" (never spinning).
// Never calls sync-done (that is CoS's job after a real pull).
import puppeteer from 'puppeteer-core'
import fs from 'fs'
const BASE = process.env.BOTMAIL_URL || 'https://botmail.velocitypulse.io'
const OUT = '/workspace/botmail/test-shots/wake-sync'
fs.mkdirSync(OUT, { recursive: true })
const APP = /^BOTMAIL_APP_KEY=(.+)$/m.exec(fs.readFileSync('/workspace/botmail/.env.botmail-secrets', 'utf8'))[1].trim()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1'
const wait = ms => new Promise(r => setTimeout(r, ms))
const rep = { samples: [], errs: [] }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const pg = await b.newPage()
  await pg.setUserAgent(UA)
  await pg.setViewport({ width: 440, height: 956, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  pg.on('pageerror', e => rep.errs.push(String(e.message || e)))
  pg.on('response', r => { const u = r.url(); if (/\/api\/(sync-request|wake-sync)/.test(u) && r.request().method() === 'POST') rep.errs.push(`net ${r.status()} ${new URL(u).pathname}`) })
  await pg.goto(BASE, { waitUntil: 'networkidle2' })
  await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle2' })
  await pg.waitForSelector('input[type="password"]'); await pg.type('input[type="password"]', APP); await pg.click('button.cnc')
  await pg.waitForSelector('.rows', { timeout: 45000 }); await wait(1000)
  const st = () => pg.evaluate(() => { const btn = document.querySelector('button.synck') || document.querySelector('button.syncb'); return { busy: !!btn?.classList.contains('busy'), aria: btn?.getAttribute('aria-label'), title: btn?.title, line: document.querySelector('.ls')?.innerText?.trim() || null, toast: document.querySelector('.toast')?.innerText?.trim() || null } })
  rep.connected = await st(); await pg.screenshot({ path: `${OUT}/01-connected.png` })
  await pg.evaluate(() => (document.querySelector('button.synck') || document.querySelector('button.syncb')).click())
  const t0 = Date.now()
  for (const at of [300, 2000, 5000, 15000, 35000, 60000, 90000, 120000]) {
    await wait(Math.max(0, at - (Date.now() - t0)))
    const s = await st(); rep.samples.push({ ms: Date.now() - t0, ...s })
    if ([300, 5000, 35000, 120000].includes(at)) await pg.screenshot({ path: `${OUT}/s-${at}.png` })
  }
  await pg.evaluate(() => [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Reload')?.click())
  await wait(2500); rep.afterReload = await st(); await pg.screenshot({ path: `${OUT}/z-after-reload.png` })
  const late = rep.samples.filter(s => s.ms >= 35000)
  const final = rep.samples.at(-1)
  rep.spinnerClearedBy35s = late.every(s => !s.busy)
  rep.finalOk = !final.busy && /Last synced|tap Reload/.test(final.title + ' ' + (final.line || ''))
  rep.pass = rep.spinnerClearedBy35s && rep.finalOk && !rep.errs.some(e => e.startsWith('pageerror'))
} catch (e) { rep.pass = false; rep.errs.push('FATAL ' + e.message) } finally { await b.close() }
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(rep, null, 2)); console.log(JSON.stringify(rep, null, 2))
