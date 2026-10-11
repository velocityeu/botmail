import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const BASE = 'https://botmail.velocitypulse.io';
const OUT = '/workspace/botmail/test-shots';
const CHROME = '/usr/bin/google-chrome';
const envText = fs.readFileSync('/workspace/botmail/.env.botmail-secrets', 'utf8');
const APP_KEY = envText.match(/^BOTMAIL_APP_KEY=(.+)$/m)[1].trim().replace(/^["']|["']$/g, '');
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const result = { consoleErrors: [], pageErrors: [] };
page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
page.on('pageerror', (e) => result.pageErrors.push(String(e.message || e)));

await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(() => { try { localStorage.removeItem('botmail.key'); localStorage.removeItem('botmail.mode'); } catch {} });
await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('input[type="password"]', { timeout: 20000 });
await page.type('input[type="password"]', APP_KEY, { delay: 2 });
await page.click('button.cnc');
await page.waitForFunction(() => /Inbox/.test(document.body.innerText), { timeout: 45000 });
await waitMs(1000);

// Open Hello thread from list
await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('button, div')].filter((el) => {
    if (!el.offsetParent) return false;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return /Hello from/i.test(t) && /One more test/i.test(t) && t.length < 300;
  });
  nodes.sort((a, b) => a.textContent.length - b.textContent.length);
  nodes[0]?.click();
});
await waitMs(1200);
await page.screenshot({ path: path.join(OUT, 'phone-02b-hello-thread.png'), fullPage: false });
const threadText = await page.evaluate(() => document.body.innerText);
result.step2 = {
  pass: /Hello/i.test(threadText) && /Ok Bot/i.test(threadText) && /ok cool/i.test(threadText) && /One more test/i.test(threadText),
  markers: {
    Hello: /Hello/i.test(threadText),
    'Ok Bot': /Ok Bot/i.test(threadText),
    'ok cool': /ok cool/i.test(threadText),
    'One more test': /One more test/i.test(threadText),
  },
};

// Back to list
await page.evaluate(() => {
  const back = [...document.querySelectorAll('button')].find((b) => /Sent|Inbox|Back|< /.test(b.textContent || '') || b.getAttribute('aria-label')?.match(/back/i));
  // Prefer explicit back chevron
  const chev = [...document.querySelectorAll('button')].find((b) => /^\s*<\s*/.test(b.textContent || '') || /←|‹|Back/i.test(b.textContent || ''));
  (chev || back)?.click();
});
await waitMs(800);
// If still in thread, try first header button
const stillThread = await page.evaluate(() => /4 MESSAGES|Reply to/i.test(document.body.innerText) && !/Compose/i.test(document.body.innerText));
if (stillThread) {
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('header button, .top button, button')];
    btns[0]?.click();
  });
  await waitMs(600);
}

// Ensure list with Compose visible
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Compose/i.test(b.textContent || '')), { timeout: 10000 }).catch(() => {});
const composeVisible = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Compose/i.test(b.textContent || '')));
if (!composeVisible) {
  // open inbox via rail
  await page.evaluate(() => {
    const knobs = [...document.querySelectorAll('button.knob')];
    const menu = knobs.find((k) => !k.classList.contains('synck'));
    menu?.click();
  });
  await waitMs(500);
  await page.evaluate(() => {
    const inbox = [...document.querySelectorAll('button.ni')].find((b) => /Inbox/.test(b.textContent || ''));
    inbox?.click();
  });
  await waitMs(700);
}

await page.evaluate(() => {
  const c = document.querySelector('button.compose-pill, button.compose-wide') ||
    [...document.querySelectorAll('button')].find((b) => /Compose/i.test(b.textContent || ''));
  c?.click();
});
await page.waitForSelector('form.sheetb, .cwrap form, .cwrap', { timeout: 10000 });
await waitMs(400);
await page.evaluate(() => {
  const form = document.querySelector('form.sheetb') || document.querySelector('.cwrap form') || document.querySelector('.cwrap');
  const inputs = [...(form?.querySelectorAll('input') || [])];
  const ta = form?.querySelector('textarea.cbody') || form?.querySelector('textarea');
  const set = (el, val) => {
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(inputs[0], 'alexander_tr@outlook.com');
  set(inputs[1], 'botmail ui test');
  set(ta, 'ui probe');
});
await waitMs(300);
await page.screenshot({ path: path.join(OUT, 'phone-05-compose.png'), fullPage: false });
const fields = await page.evaluate(() => {
  const form = document.querySelector('form.sheetb') || document.querySelector('.cwrap form') || document.querySelector('.cwrap');
  const inputs = [...(form?.querySelectorAll('input') || [])];
  const ta = form?.querySelector('textarea') ;
  return { to: inputs[0]?.value, subject: inputs[1]?.value, body: ta?.value, hasCancel: [...(form?.querySelectorAll('button') || [])].some((b) => /Cancel/i.test(b.textContent || '')) };
});
// Cancel without sending second outbound
await page.evaluate(() => {
  const form = document.querySelector('form.sheetb') || document.querySelector('.cwrap form') || document.querySelector('.cwrap');
  const cancel = [...(form?.querySelectorAll('button') || [])].find((b) => /^Cancel$/i.test((b.textContent || '').trim()));
  cancel?.click();
});
await waitMs(500);
await page.screenshot({ path: path.join(OUT, 'phone-05-compose-cancelled.png'), fullPage: false });

result.step5 = {
  pass: fields.to === 'alexander_tr@outlook.com' && fields.subject === 'botmail ui test' && fields.body === 'ui probe',
  fields,
  cancelledWithoutSend: true,
  note: 'Phone compose filled then Cancel; no second outbound (desktop already queued ob_a6cbdfde0dba457f)',
};

await context.close();
await browser.close();

// Merge into report.json
const reportPath = path.join(OUT, 'report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
report.steps['phone:2'] = {
  pass: result.step2.pass,
  connected: true,
  threadMarkers: result.step2.markers,
  note: result.step2.pass
    ? 'Opened Hello thread on phone; markers Hello / Ok Bot / ok cool / One more test'
    : 'Hello thread markers incomplete',
  shot: 'phone-02b-hello-thread.png',
};
report.steps['phone:5'] = {
  pass: result.step5.pass,
  ...result.step5,
};
report.screenshots = [...new Set([
  ...report.screenshots,
  path.join(OUT, 'phone-02b-hello-thread.png'),
  path.join(OUT, 'phone-05-compose.png'),
  path.join(OUT, 'phone-05-compose-cancelled.png'),
])];
report.consoleErrors = [...new Set([...(report.consoleErrors || []), ...result.consoleErrors])];
report.pageErrors = [...new Set([...(report.pageErrors || []), ...result.pageErrors])];
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(result, null, 2));
