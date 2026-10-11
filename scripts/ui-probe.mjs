import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const BASE = 'https://botmail.velocitypulse.io';
const OUT = '/workspace/botmail/test-shots';
const CHROME = '/usr/bin/google-chrome';

const envText = fs.readFileSync('/workspace/botmail/.env.botmail-secrets', 'utf8');
const m = envText.match(/^BOTMAIL_APP_KEY=(.+)$/m);
if (!m) throw new Error('BOTMAIL_APP_KEY missing');
const APP_KEY = m[1].trim().replace(/^["']|["']$/g, '');
if (!APP_KEY) throw new Error('BOTMAIL_APP_KEY empty');

fs.mkdirSync(OUT, { recursive: true });

const report = {
  steps: {},
  consoleErrors: [],
  pageErrors: [],
  networkFails: [],
  screenshots: [],
};

const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: false });
  report.screenshots.push(p);
  return p;
}

function attachListeners(page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') report.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => report.pageErrors.push(String(err?.message || err)));
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (/favicon/.test(u)) return;
    report.networkFails.push(`${req.failure()?.errorText || 'fail'} ${u}`);
  });
}

async function bodyText(page) {
  return page.evaluate(() => document.body?.innerText || '');
}

async function clickFolder(page, name) {
  return page.evaluate((folderName) => {
    const btns = [...document.querySelectorAll('button.ni')];
    const b = btns.find((el) => {
      const t = (el.textContent || '').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
      return t === folderName || t.startsWith(folderName + ' ');
    });
    if (!b) return false;
    b.click();
    return true;
  }, name);
}

async function openRailIfNeeded(page, isPhone) {
  if (!isPhone) return;
  const hasSent = await page.evaluate(() =>
    [...document.querySelectorAll('button.ni')].some((b) => /Sent/.test(b.textContent || '')),
  );
  if (hasSent) return;
  await page.evaluate(() => {
    const knobs = [...document.querySelectorAll('button.knob')];
    const menu = knobs.find((k) => !k.classList.contains('synck')) || knobs[0];
    menu?.click();
  });
  await waitMs(600);
}

async function runViewport(browser, label, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  attachListeners(page);
  const isPhone = viewport.width < 900;
  const prefix = label;
  const step = (n, data) => { report.steps[`${prefix}:${n}`] = data; };

  const outboundPosts = [];
  page.on('response', async (res) => {
    try {
      const req = res.request();
      if (req.method() === 'POST' && /\/api\/outbound\/?$/.test(new URL(res.url()).pathname)) {
        const j = await res.json().catch(() => null);
        outboundPosts.push({ status: res.status(), body: j });
      }
    } catch { /* ignore */ }
  });

  // --- 1 Connect ---
  try {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    // Ensure connect: clear any persisted key if somehow present
    await page.evaluate(() => {
      try {
        localStorage.removeItem('botmail.key');
        localStorage.removeItem('botmail.mode');
      } catch {}
    });
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('input[type="password"]', { timeout: 20000 });
    await waitMs(600);
    await shot(page, `${prefix}-01-connect.png`);
    const h1 = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => null);
    step(1, { pass: true, h1, note: 'Connect screen with access key input' });
  } catch (e) {
    step(1, { pass: false, error: String(e.message || e) });
    await shot(page, `${prefix}-01-connect-FAIL.png`).catch(() => {});
    await context.close();
    return;
  }

  // --- 2 Connect + inbox ---
  try {
    await page.click('input[type="password"]', { clickCount: 3 });
    await page.type('input[type="password"]', APP_KEY, { delay: 3 });
    await page.click('button.cnc');
    await page.waitForFunction(
      () => {
        const t = document.body?.innerText || '';
        return (t.includes('Inbox') && (t.includes('Compose') || t.includes('Sync'))) ||
          t.includes('That access key') || t.includes('Could not reach');
      },
      { timeout: 45000 },
    );
    await waitMs(1200);
    await shot(page, `${prefix}-02-inbox.png`);
    const text = await bodyText(page);
    const markers = {
      Hello: /Hello/i.test(text),
      'Ok Bot': /Ok Bot/i.test(text),
      'ok cool': /ok cool/i.test(text),
      'One more test': /One more test/i.test(text),
    };
    const connected = /Inbox/.test(text) && !/That access key was not accepted/.test(text);
    const allMarkers = Object.values(markers).every(Boolean);
    step(2, {
      pass: connected && allMarkers,
      connected,
      threadMarkers: markers,
      note: allMarkers
        ? 'Inbox shows Hello / Ok Bot / ok cool / One more test'
        : 'Connected but missing some expected thread markers',
    });
  } catch (e) {
    step(2, { pass: false, error: String(e.message || e) });
    await shot(page, `${prefix}-02-inbox-FAIL.png`).catch(() => {});
  }

  // --- 3 Sync ---
  try {
    await openRailIfNeeded(page, isPhone);
    const beforeLine = await page.evaluate(() => {
      const t = document.body.innerText;
      const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
      return lines.filter((l) => /sync|waiting|last|idle|requesting/i.test(l)).slice(0, 8);
    });
    const clicked = await page.evaluate((phone) => {
      if (phone) {
        const k = document.querySelector('button.synck') || document.querySelector('button[aria-label="Sync"], button[aria-label="Syncing"]');
        if (k) { k.click(); return 'synck'; }
      }
      const b = document.querySelector('button.syncb');
      if (b) { b.click(); return 'syncb'; }
      return null;
    }, isPhone);
    await waitMs(1500);
    await shot(page, `${prefix}-03-sync.png`);
    const text = await bodyText(page);
    const afterClick = {
      syncing: /Syncing/i.test(text),
      waiting: /Waiting for Grok Bot|waiting for Grok Bot/i.test(text),
      lastSynced: /Last synced/i.test(text),
      toast: /Sync requested/i.test(text),
      lines: (text.split('\n').map((l) => l.trim()).filter((l) => /Sync|Waiting|Last synced|Idle|Requesting|Grok Bot is syncing/i.test(l))).slice(0, 10),
    };
    step(3, {
      pass: !!clicked,
      beforeLine,
      afterClick,
      clicked,
      note: `UI after Sync: ${afterClick.syncing ? 'Syncing' : ''} ${afterClick.waiting ? 'waiting' : ''} ${afterClick.lastSynced ? 'Last synced' : ''} ${afterClick.toast ? 'toast' : ''}`.trim(),
    });
  } catch (e) {
    step(3, { pass: false, error: String(e.message || e) });
    await shot(page, `${prefix}-03-sync-FAIL.png`).catch(() => {});
  }

  // --- 4 Sent + select thread ---
  try {
    await openRailIfNeeded(page, isPhone);
    const sentClicked = await clickFolder(page, 'Sent');
    await waitMs(900);
    // Click a real thread row in the list (avoid filter chips)
    const selected = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('button, div, li')].filter((el) => {
        if (!el.offsetParent) return false;
        if (el.closest('.rail, .nav, aside, .cwrap, .sheetb, .reply, .composer')) return false;
        const t = (el.textContent || '').trim();
        if (t.length < 12 || t.length > 280) return false;
        if (/^(All|Unread|Bots|Compose|Inbox|Sent|Drafts|Starred|Sync|Reload|Disconnect)$/i.test(t)) return false;
        if (/Archive|Mark unread|Move to Inbox|Search mail|LABELS/.test(t) && t.length < 40) return false;
        return /Re:|@|Bot Mail|Hello|test/i.test(t);
      });
      candidates.sort((a, b) => (a.textContent.length - b.textContent.length));
      const pick = candidates[0];
      if (!pick) return null;
      pick.click();
      return (pick.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    });
    await waitMs(1000);
    await shot(page, `${prefix}-04-sent.png`);
    const text = await bodyText(page);
    const readerOk = /MESSAGE|Ok Bot|Hello|One more test|Bot Mail|QUEUED|SENT/i.test(text);
    const onSent = /\bSent\b/.test(text);
    step(4, {
      pass: sentClicked && readerOk,
      sentClicked,
      selectedSnippet: selected,
      readerUpdated: readerOk,
      onSent,
    });
  } catch (e) {
    step(4, { pass: false, error: String(e.message || e) });
    await shot(page, `${prefix}-04-sent-FAIL.png`).catch(() => {});
  }

  // --- 5 Compose ---
  try {
    if (isPhone) await page.keyboard.press('Escape');
    await waitMs(300);
    await page.evaluate(() => {
      const a = document.activeElement;
      if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) a.blur();
    });

    const composeClicked = await page.evaluate(() => {
      const wide = document.querySelector('button.compose-wide, button.compose-pill');
      if (wide) { wide.click(); return true; }
      const any = [...document.querySelectorAll('button')].find((el) => /Compose/i.test(el.textContent || ''));
      if (any) { any.click(); return true; }
      return false;
    });
    await page.waitForSelector('form.sheetb, .cwrap form', { timeout: 10000 });
    await waitMs(400);

    await page.evaluate(() => {
      const form = document.querySelector('form.sheetb') || document.querySelector('.cwrap form');
      if (!form) return;
      const inputs = [...form.querySelectorAll('input')];
      const to = inputs[0];
      const sub = inputs[1];
      const ta = form.querySelector('textarea.cbody') || form.querySelector('textarea');
      const set = (el, val) => {
        if (!el) return;
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(to, 'alexander_tr@outlook.com');
      set(sub, 'botmail ui test');
      set(ta, 'ui probe');
    });
    await waitMs(300);
    await shot(page, `${prefix}-05-compose.png`);

    const fields = await page.evaluate(() => {
      const form = document.querySelector('form.sheetb') || document.querySelector('.cwrap form');
      const inputs = [...(form?.querySelectorAll('input') || [])];
      const ta = form?.querySelector('textarea.cbody') || form?.querySelector('textarea');
      return { to: inputs[0]?.value, subject: inputs[1]?.value, body: ta?.value, sendDisabled: form?.querySelector('button.sendc')?.disabled };
    });

    const beforePosts = outboundPosts.length;
    await page.evaluate(() => {
      const form = document.querySelector('form.sheetb') || document.querySelector('.cwrap form');
      const btn = form?.querySelector('button.sendc');
      btn?.click();
    });
    await page.waitForFunction(() => {
      const t = document.body.innerText;
      return !document.querySelector('form.sheetb') || /Queued|Not queued|waiting to send/i.test(t);
    }, { timeout: 15000 }).catch(() => {});
    await waitMs(1500);
    await shot(page, `${prefix}-05-after-send.png`);

    const newPosts = outboundPosts.slice(beforePosts);
    let queuedId = newPosts.map((p) => p.body?.item?.id).find(Boolean) || null;
    let queuedStatus = newPosts.map((p) => p.body?.item?.status).find(Boolean) || null;
    const text = await bodyText(page);
    const toastQueued = /Queued/i.test(text) && !/Not queued/i.test(text);

    let cancelled = false;
    const hasCancel = await page.evaluate(() =>
      [...document.querySelectorAll('button.chip')].some((b) => /^Cancel$/i.test((b.textContent || '').trim())),
    );
    if (hasCancel) {
      await page.evaluate(() => {
        const c = [...document.querySelectorAll('button.chip')].find((b) => /^Cancel$/i.test((b.textContent || '').trim()));
        c?.click();
      });
      await waitMs(1000);
      cancelled = /Cancelled/i.test(await bodyText(page));
      await shot(page, `${prefix}-05-cancelled.png`);
    } else {
      await openRailIfNeeded(page, isPhone);
      await clickFolder(page, 'Sent');
      await waitMs(900);
      await shot(page, `${prefix}-05-sent-queue.png`);
      if (!queuedId) {
        queuedId = await page.evaluate(() => {
          const t = document.body.innerText;
          const m = t.match(/ob:[a-zA-Z0-9_-]+/);
          return m?.[0] || null;
        });
      }
    }

    step(5, {
      pass: composeClicked && fields.body === 'ui probe' && (toastQueued || !!queuedId || !!newPosts.length),
      composeClicked,
      fields,
      sendHttp: newPosts.map((p) => ({ status: p.status, id: p.body?.item?.id || null, itemStatus: p.body?.item?.status || null, error: p.body?.error || null })),
      queuedId,
      queuedStatus,
      toastQueued,
      cancelled,
      note: cancelled
        ? `Queued then cancelled (id ${queuedId || 'unknown'})`
        : queuedId
          ? `Left queued id=${queuedId} status=${queuedStatus || 'unknown'}`
          : newPosts.length
            ? `Outbound POST seen HTTP ${newPosts[0].status}`
            : 'Send attempted; queue not confirmed',
    });
  } catch (e) {
    step(5, { pass: false, error: String(e.message || e) });
    await shot(page, `${prefix}-05-compose-FAIL.png`).catch(() => {});
  }

  await context.close();
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,900'],
});

try {
  await runViewport(browser, 'desktop', { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  await runViewport(browser, 'phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
} finally {
  await browser.close();
}

report.consoleErrors = [...new Set(report.consoleErrors)].slice(0, 40);
report.pageErrors = [...new Set(report.pageErrors)].slice(0, 20);
report.networkFails = [...new Set(report.networkFails)].slice(0, 30);

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('PROBE_DONE');
const summary = {};
for (const [k, v] of Object.entries(report.steps)) summary[k] = { pass: v.pass, note: v.note || v.error || null, extra: v.queuedId || v.afterClick || v.threadMarkers || null };
console.log(JSON.stringify({
  summary,
  shots: report.screenshots.map((p) => path.basename(p)),
  consoleErrors: report.consoleErrors,
  pageErrors: report.pageErrors,
  networkFails: report.networkFails,
}, null, 2));
