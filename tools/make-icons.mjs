import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
const svg = (pad) => `<html><body style="margin:0;background:#100f0d"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" style="display:block"><rect width="64" height="64" fill="#100f0d"/><g transform="translate(${pad} ${pad}) scale(${(64 - 2 * pad) / 64})"><circle cx="32" cy="32" r="19" fill="none" stroke="#e8b04a" stroke-width="3"/><circle cx="32" cy="32" r="5" fill="#e8b04a"/><path d="M32 13v8" stroke="#efe8da" stroke-width="3" stroke-linecap="round"/></g></svg></body></html>`;
for (const [name, size, pad] of [['icon-192.png', 192, 4], ['icon-512.png', 512, 4], ['icon-maskable-512.png', 512, 12], ['apple-touch-icon.png', 180, 6]]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(svg(pad));
  await p.screenshot({ path: `public/${name}` });
}
await b.close();
