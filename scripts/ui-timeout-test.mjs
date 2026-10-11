// Forces GET /api/sync-request to stay 'pending' (request interception) to prove the 90 s hard timeout stops the spinner.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const BASE = 'https://botmail.velocitypulse.io', OUT = '/workspace/botmail/test-shots/retest';
const APP = fs.readFileSync('/workspace/botmail/.env.botmail-secrets', 'utf8').match(/^BOTMAIL_APP_KEY=(.+)$/m)[1].trim().replace(/^["']|["']$/g, '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1440, height: 900 });
let sawPost = false;
await pg.setRequestInterception(true);
pg.on('request', (r) => {
  const u = new URL(r.url());
  if (u.pathname === '/api/sync-request') {
    if (r.method() === 'POST') sawPost = true; // never hit the real server: no real sync request raised
    const now = new Date().toISOString();
    return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ request: { id: 'fake', status: 'pending', requestedAt: now, requestedBy: 'app', startedAt: null, completedAt: null, presses: 1 }, pending: true, syncedAt: '2026-10-11T22:25:05.265Z' }) });
  }
  r.continue();
});
await pg.goto(BASE, { waitUntil: 'networkidle2' }); await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle2' });
await pg.type('input[type="password"]', APP); await pg.click('button.cnc'); await pg.waitForSelector('button.syncb');
await pg.click('button.syncb'); await wait(1500);
const st = () => pg.evaluate(() => ({ busy: !!document.querySelector('button.syncb.busy'), label: document.querySelector('button.syncb').innerText.trim(), line: document.querySelector('.ls').innerText.trim() }));
const a = await st(); const t0 = Date.now(); let c;
while (Date.now() - t0 < 110000) { await wait(2000); c = await st(); if (!c.busy) break; }
await pg.screenshot({ path: `${OUT}/desktop-08-sync-hard-timeout.png` });
console.log(JSON.stringify({ sawPost, afterClick: a, final: c, secs: Math.round((Date.now() - t0) / 1000) }));
await b.close();
