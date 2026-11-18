// Auth: wrong passwords are rate-limited per IP; a magic link links an email, works once,
// and signs a second device in to the same account. Local server only (the QA link shortcut
// is disabled on Vercel). Usage: node tests/auth.mjs http://localhost:3311
import fs from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:3311';
const sitePass = fs.readFileSync(`${process.env.HOME}/.config/music-radio/app.env`, 'utf8').match(/^SITE_PASSWORD=(.*)$/m)[1];
const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
const H = (extra = {}) => ({ 'content-type': 'application/json', 'x-radio-qa': '1', 'x-forwarded-for': ip, ...extra });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(ok ? 'ok  ' : 'FAIL', name, detail); };

// 1. Every attempt counts before the password check: after ten, even the right one is refused.
for (let i = 0; i < 10; i++) await fetch(`${base}/api/login`, { method: 'POST', headers: H(), body: JSON.stringify({ pass: 'nope' }) });
const r11 = await fetch(`${base}/api/login`, { method: 'POST', headers: H(), body: JSON.stringify({ pass: sitePass }) });
check('11th try from that IP is blocked', r11.status === 429, String(r11.status));

// 2. Device A signs in, links an email by magic link; the link works once.
const ipA = `198.51.100.${Math.floor(Math.random() * 250)}`;
const a = await fetch(`${base}/api/login`, { method: 'POST', headers: H({ 'x-forwarded-for': ipA }), body: JSON.stringify({ pass: sitePass, name: 'QA auth' }) });
const cookieA = a.headers.get('set-cookie').split(';')[0];
const email = `qa+${Date.now()}@example.com`;
const sent = await (await fetch(`${base}/api/auth/email`, { method: 'POST', headers: H({ cookie: cookieA }), body: JSON.stringify({ email }) })).json();
check('magic link issued', !!sent.link);
const v1 = await fetch(sent.link, { redirect: 'manual', headers: { cookie: cookieA } });
check('link signs in (same browser)', [303, 307].includes(v1.status) && v1.headers.get('location').endsWith('/'), `${v1.status} ${v1.headers.get('location')}`);
const v2 = await fetch(sent.link, { redirect: 'manual', headers: { cookie: cookieA } });
check('link is single use', (v2.headers.get('location') ?? '').includes('link=expired'));
const meA = await (await fetch(`${base}/api/me`, { headers: H({ cookie: cookieA }) })).json();
check('email linked to device A', meA.email === email, String(meA.email));

// 3. Device B (fresh cookie) recovers device A's account with a link to the same email.
const b = await fetch(`${base}/api/login`, { method: 'POST', headers: H({ 'x-forwarded-for': ipA }), body: JSON.stringify({ pass: sitePass, name: 'QA other' }) });
const cookieB = b.headers.get('set-cookie').split(';')[0];
const sentB = await (await fetch(`${base}/api/auth/email`, { method: 'POST', headers: H({ cookie: cookieB }), body: JSON.stringify({ email }) })).json();
const vb = await fetch(sentB.link, { redirect: 'manual', headers: { cookie: cookieB } });
const cookieB2 = vb.headers.get('set-cookie')?.split(';')[0];
const meB = await (await fetch(`${base}/api/me`, { headers: H({ cookie: cookieB2 }) })).json();
check('device B is now device A’s account', meB.name === 'QA auth' && meB.email === email, `${meB.name} ${meB.email}`);

// 4. A link opened in another browser asks first and never links silently.
const ipC = `192.0.2.${Math.floor(Math.random() * 250)}`;
const la = await fetch(`${base}/api/login`, { method: 'POST', headers: H({ 'x-forwarded-for': ipC }), body: JSON.stringify({ pass: sitePass, name: 'QA asker' }) });
const cookieAsk = la.headers.get('set-cookie').split(';')[0];
const lc = await fetch(`${base}/api/login`, { method: 'POST', headers: H({ 'x-forwarded-for': ipC }), body: JSON.stringify({ pass: sitePass, name: 'QA clicker' }) });
const cookieClick = lc.headers.get('set-cookie').split(';')[0];
const email2 = `qa+x${Date.now()}@example.com`;
const sent2 = await (await fetch(`${base}/api/auth/email`, { method: 'POST', headers: H({ cookie: cookieAsk }), body: JSON.stringify({ email: email2 }) })).json();
const g = await fetch(sent2.link, { redirect: 'manual', headers: { cookie: cookieClick } });
check('other browser is asked to confirm', (g.headers.get('location') ?? '').includes('/signin?t='), g.headers.get('location'));
check('no account switch before confirming', !(g.headers.get('set-cookie') ?? '').includes('mr_session'));
const meAsk = await (await fetch(`${base}/api/me`, { headers: H({ cookie: cookieAsk }) })).json();
check('email not linked silently', meAsk.email === null, String(meAsk.email));
const page = await (await fetch(new URL(g.headers.get('location'), base), { headers: { cookie: cookieClick } })).text();
check('confirm page names the email', page.includes(email2) && page.includes('Sign in as'));
const nonce = (g.headers.get('set-cookie') ?? '').match(/mr_confirm=([^;]+)/)?.[1];
check('confirm nonce cookie set', !!nonce);
const tok2 = new URL(sent2.link).searchParams.get('t');
const form = (n) => new URLSearchParams({ t: tok2, nonce: n });
const post = (headers, n) => fetch(`${base}/api/auth/verify`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(n) });
const evil = await post({ cookie: `${cookieClick}; mr_confirm=${nonce}`, origin: 'https://evil.example' }, nonce);
check('cross-origin confirm refused', evil.status === 403, String(evil.status));
const noNonce = await post({ cookie: cookieClick, origin: base }, nonce);
check('confirm without the nonce cookie refused', noNonce.status === 403, String(noNonce.status));
const wrongNonce = await post({ cookie: `${cookieClick}; mr_confirm=${nonce}`, origin: base }, 'x'.repeat(nonce.length));
check('confirm with a wrong nonce refused', wrongNonce.status === 403, String(wrongNonce.status));
const conf = await post({ cookie: `${cookieClick}; mr_confirm=${nonce}`, origin: base }, nonce);
const cookieClick2 = conf.headers.get('set-cookie')?.split(';')[0];
const meClick = await (await fetch(`${base}/api/me`, { headers: H({ cookie: cookieClick2 }) })).json();
check('after confirming, that browser is the asker’s account', meClick.name === 'QA asker' && meClick.email === email2, `${meClick.name} ${meClick.email}`);

// 5. Claim codes: five tries per IP and account per 15 minutes, then refused.
const ipD = `100.64.0.${Math.floor(Math.random() * 250)}`;
const ld = await fetch(`${base}/api/login`, { method: 'POST', headers: H({ 'x-forwarded-for': ipD }), body: JSON.stringify({ pass: sitePass, name: 'QA claimer' }) });
const cookieD = ld.headers.get('set-cookie').split(';')[0];
const tries = [];
for (let i = 0; i < 6; i++) tries.push((await fetch(`${base}/api/auth/claim`, { method: 'POST', headers: H({ cookie: cookieD, 'x-forwarded-for': ipD }), body: JSON.stringify({ code: `mate-${'0'.repeat(32)}${i}` }) })).status);
check('sixth claim try refused', tries.slice(0, 5).every((x) => x === 400) && tries[5] === 429, tries.join(','));

// 6. No cookie, no music.
const anon = await fetch(`${base}/api/queue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('signed-out API refused', anon.status === 401);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL ${failed.length}` : `PASS ${results.length}`);
process.exit(failed.length ? 1 : 0);
