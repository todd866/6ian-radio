// Headless smoke test of the tile-first player: sign in, Home (shelves of art), one tap on a tile
// plays it (muted: ?silent=1), skip, a song ending into the next, like persists, mini-player,
// profile sheet, and no sideways page overflow. Screenshots in light and dark.
// Usage: node tests/smoke.mjs <baseURL> [shotsDir]
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3311';
const shots = process.argv[3];
const sitePass = process.env.SITE_PASSWORD ?? fs.readFileSync(`${process.env.HOME}/.config/music-radio/app.env`, 'utf8').match(/^SITE_PASSWORD=(.*)$/m)[1];
const user = process.env.SMOKE_USER ?? 'ian';
const fail = (m) => { throw new Error(m); };
const results = [];
const title = (p) => p.textContent('h1.title');
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.app2 > *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1));

async function run(engineName, engine, opts) {
  const browser = await engine.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ ...opts, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const events = [];
    page.on('response', async (r) => { if (r.url().includes('/api/event')) events.push(`${r.status()} ${(await r.text().catch(() => '')).slice(0, 40)}`); });
    const codecs = await page.evaluate(() => { const a = document.createElement('audio'); return { aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'), alac: a.canPlayType('audio/mp4; codecs="alac"') }; });
    await page.goto(`${base}/login?silent=1`);
    await page.fill('input[name=pass]', sitePass);
    await page.fill('input[name=name]', `QA ${user}`);
    await page.click('button.btn.primary');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.waitForSelector('html[data-ready="1"] [data-testid=tile]');
    await page.waitForTimeout(1500); // covers
    const out = { engine: engineName, codecs, homeFit: await noSideways(page), shelves: await page.locator('.shelf').count(), tiles: await page.locator('[data-testid=tile]').count() };
    if (shots) await page.screenshot({ path: `${shots}/${engineName}-home-dark.png` });
    // One tap on the first Quick pick plays it.
    await page.locator('.shelf').first().locator('[data-testid=tile] .tileart').first().click();
    await page.waitForSelector('.np h1.title');
    out.played = await page.waitForFunction(() => { const a = window.__radio?.audio; return a && a.currentTime > 1 && !a.paused; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    out.npFit = await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1) && await noSideways(page);
    if (shots) await page.screenshot({ path: `${shots}/${engineName}-np-dark.png` });
    const t1 = await title(page);
    await page.click('[data-testid=skip]');
    await page.waitForFunction((t) => document.querySelector('.np h1.title')?.textContent !== t, t1, { timeout: 10000 });
    const t2 = await title(page);
    out.skipped = t1 !== t2;
    await page.waitForFunction(() => Number.isFinite(window.__radio.audio.duration) && window.__radio.audio.duration > 10, null, { timeout: 15000 });
    await page.evaluate(() => { const a = window.__radio.audio; a.currentTime = a.duration - 3; });
    await page.waitForFunction((t) => document.querySelector('.np h1.title')?.textContent !== t, t2, { timeout: 20000 });
    out.endedToNext = await page.waitForFunction(() => !window.__radio.audio.paused && window.__radio.audio.currentTime > 0.5, null, { timeout: 20000 }).then(() => true).catch(() => false);
    const liked = page.waitForResponse(async (r) => r.url().includes('/api/event') && (await r.text().catch(() => '')).includes('"liked":true'), { timeout: 20000 }).catch(() => null);
    await page.click('[data-testid=like]');
    await liked; // it can queue behind the song-end and next-play writes to the same profile
    const me = await page.evaluate(() => fetch('/api/me', { headers: { 'x-radio-qa': '1' } }).then((r) => r.json()));
    out.likes = me.counts.likes;
    out.events = events.slice(-3);
    await page.click('[data-testid=tab-related]'); await page.waitForTimeout(1200);
    out.related = await page.locator('.uprow').count();
    if (shots) await page.screenshot({ path: `${shots}/${engineName}-np-related-dark.png` });
    await page.click('[data-testid=np-close]');
    out.mini = await page.locator('[data-testid=mini]').isVisible();
    if (shots) {
      await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(500);
      await page.screenshot({ path: `${shots}/${engineName}-home-light.png` });
      await page.click('[data-testid=mini]'); await page.waitForTimeout(500);
      await page.screenshot({ path: `${shots}/${engineName}-np-light.png` });
      await page.click('[data-testid=np-close]');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.click('[data-testid=profile]'); await page.waitForTimeout(1200);
      await page.screenshot({ path: `${shots}/${engineName}-profile-dark.png` });
    }
    results.push(out);
    if (!out.homeFit) fail(`${engineName}: home overflows sideways`);
    if (!out.npFit) fail(`${engineName}: now playing scrolls or overflows`);
    if (!out.played) fail(`${engineName}: tile tap did not play`);
    if (!out.skipped) fail(`${engineName}: skip did not change track`);
    if (!out.endedToNext) fail(`${engineName}: song end did not start the next`);
    if (out.likes < 1) fail(`${engineName}: like not persisted`);
    return out;
  } finally {
    await browser.close();
  }
}

try {
  await run('phone-webkit', webkit, { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } });
  await run('phone-chrome', chromium, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await run('desktop-chrome', chromium, { viewport: { width: 1440, height: 900 } });
} finally {
  console.log(JSON.stringify(results, null, 1));
}
