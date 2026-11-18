// 20 play events fired at once must all land in the (QA) profile: no lost updates.
// Usage: node tests/concurrency.mjs <baseURL>
import fs from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:3311';
const sitePass = process.env.SITE_PASSWORD ?? fs.readFileSync(`${process.env.HOME}/.config/music-radio/app.env`, 'utf8').match(/^SITE_PASSWORD=(.*)$/m)[1];
const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-radio-qa': '1' }, body: JSON.stringify({ pass: sitePass, name: 'QA concurrency' }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const h = { cookie, 'content-type': 'application/json', 'x-radio-qa': '1' };
const me = async () => (await (await fetch(`${base}/api/me`, { headers: h })).json()).counts.plays;
const q = await (await fetch(`${base}/api/queue`, { method: 'POST', headers: h, body: JSON.stringify({ mood: 'wide', n: 20, canAlac: true }) })).json();
const before = await me();
const res = await Promise.all(q.picks.slice(0, 20).map((p) => fetch(`${base}/api/event`, { method: 'POST', headers: h, body: JSON.stringify({ pt: p.pt, ev: 'play' }) }).then((r) => r.status)));
const after = await me();
const ok = res.every((s) => s === 200) && after - before === q.picks.slice(0, 20).length;
console.log(JSON.stringify({ sent: res.length, statuses: [...new Set(res)], before, after, landed: after - before }), ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
