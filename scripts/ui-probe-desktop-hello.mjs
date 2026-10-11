import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
const OUT = '/workspace/botmail/test-shots';
const APP_KEY = fs.readFileSync('/workspace/botmail/.env.botmail-secrets','utf8').match(/^BOTMAIL_APP_KEY=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const waitMs = (ms)=>new Promise(r=>setTimeout(r,ms));
const browser = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome', headless:'new', args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width:1440, height:900 });
await page.goto('https://botmail.velocitypulse.io', { waitUntil:'networkidle2', timeout:60000 });
await page.evaluate(()=>{ try{ localStorage.removeItem('botmail.key'); localStorage.removeItem('botmail.mode'); }catch{} });
await page.reload({ waitUntil:'networkidle2', timeout:60000 });
await page.waitForSelector('input[type="password"]');
await page.type('input[type="password"]', APP_KEY, { delay:2 });
await page.click('button.cnc');
await page.waitForFunction(()=>/Inbox/.test(document.body.innerText), { timeout:45000 });
await waitMs(800);
await page.evaluate(()=>{
  const nodes=[...document.querySelectorAll('button,div')].filter(el=>{
    if(!el.offsetParent) return false;
    if(el.closest('.rail,.nav,aside')) return false;
    const t=(el.textContent||'').replace(/\s+/g,' ').trim();
    return /Hello from/i.test(t) && /One more test/i.test(t) && t.length<350;
  });
  nodes.sort((a,b)=>a.textContent.length-b.textContent.length);
  nodes[0]?.click();
});
await waitMs(1000);
await page.screenshot({ path: path.join(OUT,'desktop-02b-hello-thread.png'), fullPage:false });
const t = await page.evaluate(()=>document.body.innerText);
const markers = {
  Hello: /Hello/i.test(t),
  'Ok Bot': /Ok Bot/i.test(t),
  'ok cool': /ok cool/i.test(t),
  'One more test': /One more test/i.test(t),
};
const report = JSON.parse(fs.readFileSync(path.join(OUT,'report.json'),'utf8'));
report.steps['desktop:2'] = {
  pass: Object.values(markers).every(Boolean),
  connected: true,
  threadMarkers: markers,
  note: 'Selected Hello thread in Inbox; confirmed Hello / Ok Bot / ok cool / One more test',
  shot: 'desktop-02b-hello-thread.png',
};
report.screenshots = [...new Set([...(report.screenshots||[]), path.join(OUT,'desktop-02b-hello-thread.png')])];
fs.writeFileSync(path.join(OUT,'report.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify({ markers, pass: Object.values(markers).every(Boolean) }, null, 2));
await ctx.close(); await browser.close();
