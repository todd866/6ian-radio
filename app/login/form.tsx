'use client';
import { useEffect, useState } from 'react';

export default function LoginForm() {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (new URLSearchParams(location.search).get('link') === 'expired') setErr('That sign-in link has expired or was already used.'); }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr('');
    const qa = new URLSearchParams(location.search).has('silent');
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', ...(qa ? { 'x-radio-qa': '1' } : {}) }, body: JSON.stringify({ pass: f.get('pass'), name: f.get('name') }) });
    if (r.ok) { location.href = '/' + location.search.replace(/[?&]link=expired/, ''); return; }
    setErr((await r.json().catch(() => ({}))).error ?? 'Sign-in failed');
    setBusy(false);
  }
  return (
    <main className="login">
      <form onSubmit={submit}>
        <div className="call">6<b>IAN</b></div>
        <input className="field" name="pass" type="password" autoComplete="current-password" placeholder="Station password" aria-label="Station password" required />
        <input className="field" name="name" autoComplete="nickname" placeholder="Your name (optional)" aria-label="Your name" maxLength={24} />
        <button className="btn primary" disabled={busy}>{busy ? 'Tuning in…' : 'Tune in'}</button>
        <div className="err" role="alert">{err}</div>
      </form>
    </main>
  );
}
