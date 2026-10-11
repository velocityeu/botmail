// Post-deploy E2E: Connect, threads, Sync clears (ack path + hard-timeout path), Sent, queue+cancel.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const BASE = 'https://botmail.velocitypulse.io';
const OUT = '/workspace/botmail/test-shots/retest';
const env = fs.readFileSync('/workspace/botmail/.env.botmail-secrets', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))[1].trim().replace(/^["']|["']$/g, '');
const APP = get('BOTMAIL_APP_KEY'), SYNC = get('BOTMAIL_SYNC_SECRET');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const res = {}; const errs = [];
const api = (p, key, init = {}) => fetch(BASE + p, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` } }).then((r) => r.json());
const txt = (pg) => pg.evaluate(() => document.body.innerText);
const syncState = (pg) => pg.evaluate(() => ({
  busy: !!document.querySelector('button.syncb.busy, button.synck.busy'),
  label: document.querySelector('button.syncb')?.innerText?.trim() || document.querySelector('button.synck')?.getAttribute('aria-label'),
  line: document.querySelector('.ls')?.innerText?.trim() || document.querySelector('button.synck')?.title || null,
}));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });

async function connect(label, vp) {
  const ctx = await browser.createBrowserContext(); const pg = await ctx.newPage(); await pg.setViewport(vp);
  pg.on('pageerror', (e) => errs.push(`${label} pageerror ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(`${label} console ${m.text()}`); });
  await pg.goto(BASE, { waitUntil: 'networkidle2' });
  await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle2' });
  await pg.waitForSelector('input[type="password"]');
  await pg.screenshot({ path: `${OUT}/${label}-01-connect.png` });
  await pg.type('input[type="password"]', APP); await pg.click('button.cnc');
  await pg.waitForFunction(() => document.querySelector('.rows') || /not accepted|Could not reach/.test(document.body.innerText), { timeout: 30000 });
  await wait(1000);
  const t = await txt(pg);
  const rows = await pg.$$eval('.rows button.row', (b) => b.length);
  res[`${label}:connect`] = !/not accepted|Could not reach/.test(t);
  res[`${label}:threads`] = rows > 0 && /Hello/.test(t) ? `PASS (${rows} rows)` : `FAIL (${rows} rows)`;
  await pg.screenshot({ path: `${OUT}/${label}-02-inbox.png` });
  return pg;
}
const clickSync = (pg) => pg.evaluate(() => (document.querySelector('button.synck') || document.querySelector('button.syncb'))?.click());
const openRail = async (pg) => { if (!(await pg.$('aside.rail'))) { await pg.evaluate(() => [...document.querySelectorAll('button.knob')].find((k) => k.getAttribute('aria-label') === 'Mailboxes')?.click()); await wait(500); } };

try {
  // Desktop: Sync clears when the request completes (CoS path simulated with an empty merge snapshot = no data change).
  const d = await connect('desktop', { width: 1440, height: 900 });
  await clickSync(d); await wait(1500);
  const s1 = await syncState(d); await d.screenshot({ path: `${OUT}/desktop-03-syncing.png` });
  await api('/api/sync', SYNC, { method: 'POST', body: JSON.stringify({ threads: [], mode: 'merge' }) });
  let s2; const t0 = Date.now();
  while (Date.now() - t0 < 20000) { await wait(1000); s2 = await syncState(d); if (!s2.busy) break; }
  await d.screenshot({ path: `${OUT}/desktop-04-sync-cleared.png` });
  res['desktop:sync-busy-after-click'] = s1; res['desktop:sync-clears-on-done'] = { ...s2, secs: Math.round((Date.now() - t0) / 1000), pass: !s2.busy };
  // Sent
  await d.evaluate(() => [...document.querySelectorAll('button.ni')].find((b) => /^Sent/.test(b.innerText.trim()))?.click()); await wait(800);
  const sentRows = await d.$$eval('.rows button.row', (b) => b.length);
  if (sentRows) { await d.click('.rows button.row'); await wait(800); }
  res['desktop:sent'] = { rows: sentRows, title: await d.$eval('.lhead h1', (e) => e.innerText), reader: await d.$eval('.rsub h2', (e) => e.innerText).catch(() => null) };
  await d.screenshot({ path: `${OUT}/desktop-05-sent.png` });
  // Compose -> queue -> cancel (probe item, never delivered)
  await d.click('button.compose-wide'); await d.waitForSelector('form.sheetb');
  const ins = await d.$$('form.sheetb input'); await ins[0].type('alexander_tr@outlook.com'); await ins[1].type('botmail ui test'); await d.type('form.sheetb textarea', 'ui probe');
  const respP = d.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/outbound$/.test(r.url()));
  await d.click('button.sendc'); const item = (await (await respP).json()).item;
  await wait(1200); await d.screenshot({ path: `${OUT}/desktop-06-queued.png` });
  const c = await api(`/api/outbound/${item.id}`, APP, { method: 'POST', body: JSON.stringify({ status: 'cancelled' }) });
  res['desktop:queue+cancel'] = { id: item.id, queued: item.status, after: c.item?.status };
  await d.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Reload')?.click()); await wait(2000);
  await d.screenshot({ path: `${OUT}/desktop-07-cancelled.png` });

  // Phone: nobody completes the request -> hard timeout must stop the spinner.
  const p = await connect('phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await clickSync(p); await wait(1500);
  const p1 = await syncState(p); await p.screenshot({ path: `${OUT}/phone-03-syncing.png` });
  const t1 = Date.now(); let p2;
  while (Date.now() - t1 < 110000) { await wait(2000); p2 = await syncState(p); if (!p2.busy) break; }
  await openRail(p); await wait(300); const line = await syncState(p);
  await p.screenshot({ path: `${OUT}/phone-04-sync-timeout.png` });
  res['phone:sync-busy-after-click'] = p1; res['phone:sync-hard-timeout'] = { ...line, secs: Math.round((Date.now() - t1) / 1000), pass: !p2.busy };
  await p.evaluate(() => [...document.querySelectorAll('button.ni')].find((b) => /^Sent/.test(b.innerText.trim()))?.click()); await wait(800);
  res['phone:sent'] = { rows: await p.$$eval('.rows button.row', (b) => b.length) };
  await p.screenshot({ path: `${OUT}/phone-05-sent.png` });
} catch (e) { errs.push('FATAL ' + e.message); } finally { await browser.close(); }
console.log(JSON.stringify({ res, errs }, null, 2));
