'use client';
import { useEffect, useState } from 'react';
import { qaHeaders } from './Radio';

type Rate = { n: number; like: number | null; skip: number | null };
type Me = {
  name: string; style: string; email: string | null; tz: string; newShare: number; clock: string; rule: string;
  score: { ai: Rate; control: Rate; new: Rate; library: Rate };
  counts: { likes: number; plays: number; today: number };
  library: { songs: number; embedded: number; inR2: number; gaps: { embeddedNotInR2: number; inR2NotEmbedded: number; downloadedNotInR2?: number | null }; aac: number; art: number; mapAt: string; gapsAt?: string; spend?: { today: number; cap: number } | null; scout?: { week: number; budget: number; back: number | null; decades: Record<string, number> | null; at: string } | null; workerAt?: string | null; lane?: { today: number; week: number; total: number; byTag: Record<string, number>; byDecade: Record<string, number>; artistsQueued: number; driveFreeGb: number } | null };
};
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const ZONES = ['Australia/Perth', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Hobart', 'Pacific/Auckland', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'America/Los_Angeles', 'America/New_York'];

export function MeView({ lossless, canLossless, setLossless, onNewShare }: { lossless: boolean; canLossless: boolean; setLossless: (v: boolean) => void; onNewShare: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [share, setShare] = useState(0.6);
  useEffect(() => { fetch('/api/me', { headers: qaHeaders() }).then((r) => r.json()).then((d: Me) => { setMe(d); setShare(d.newShare); }); }, []);
  const save = async (b: Record<string, unknown>) => {
    const r = await fetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json', ...qaHeaders() }, body: JSON.stringify(b) });
    const j = await r.json();
    if (me) setMe({ ...me, ...j });
  };
  if (!me) return <section className="me" aria-busy="true" />;
  const s = me.score;
  const lead = (a: number | null, b: number | null) => (a !== null && b !== null && a > b ? 'v lead' : 'v');
  const L = me.library;
  return (
    <section className="me" aria-label="Profile">
      <div className="card" data-testid="scoreboard">
        <h3>Our picks vs random</h3>
        <div className="score num">
          <span className="h">picks</span><span className="h">liked</span><span className="h">skipped</span><span className="h">n</span>
          <span>Picks</span><span className={lead(s.ai.like, s.control.like)}>{pct(s.ai.like)}</span><span className="v">{pct(s.ai.skip)}</span><span className="v">{s.ai.n}</span>
          <span>Random</span><span className="v">{pct(s.control.like)}</span><span className="v">{pct(s.control.skip)}</span><span className="v">{s.control.n}</span>
          <span>New</span><span className="v">{pct(s.new.like)}</span><span className="v">{pct(s.new.skip)}</span><span className="v">{s.new.n}</span>
          <span>Library</span><span className="v">{pct(s.library.like)}</span><span className="v">{pct(s.library.skip)}</span><span className="v">{s.library.n}</span>
        </div>
      </div>
      <div className="card">
        <h3>Mix</h3>
        <label className="kv"><span>New music share</span><span className="num">{Math.round(share * 100)}%</span></label>
        <input type="range" min={0} max={100} step={5} value={Math.round(share * 100)} aria-label="New music share"
          onChange={(e) => setShare(Number(e.target.value) / 100)}
          onPointerUp={() => { save({ newShare: share }).then(onNewShare); }} onKeyUp={() => { save({ newShare: share }).then(onNewShare); }} />
        <div className="kv" style={{ marginTop: 10 }}>
          <span>Time zone</span>
          <span><select value={me.tz} onChange={(e) => save({ tz: e.target.value })} aria-label="Time zone">{(ZONES.includes(me.tz) ? ZONES : [me.tz, ...ZONES]).map((z) => <option key={z}>{z}</option>)}</select></span>
          <span>Local time</span><span className="num">{me.clock} · {me.rule}</span>
          <span>Quality</span>
          <span>
            {canLossless ? (
              <label><input type="checkbox" checked={lossless} onChange={(e) => setLossless(e.target.checked)} /> Lossless</label>
            ) : <span title="This browser cannot play ALAC; AAC 256 is used">AAC 256</span>}
          </span>
        </div>
      </div>
      <div className="card">
        <h3>Library</h3>
        <div className="kv num">
          <span>Songs on the map</span><span>{L.songs}</span>
          <span>Ready to stream (AAC)</span><span>{L.aac}</span>
          <span>Covers</span><span>{L.art}</span>
          <span>In R2, not embedded</span><span className={L.gaps.inR2NotEmbedded ? 'warn' : ''}>{L.gaps.inR2NotEmbedded}</span>
          <span>Embedded, not in R2</span><span className={L.gaps.embeddedNotInR2 ? 'warn' : ''}>{L.gaps.embeddedNotInR2}</span>
          {L.gaps.downloadedNotInR2 != null && <><span>Downloaded, not in R2</span><span className={L.gaps.downloadedNotInR2 ? 'warn' : ''}>{L.gaps.downloadedNotInR2}</span></>}
          {L.spend && <><span>Embedding spend today</span><span>${L.spend.today.toFixed(2)} of ${L.spend.cap.toFixed(2)}</span></>}
          {L.scout && <><span>New songs this week</span><span>{L.scout.week} of {L.scout.budget}</span></>}
          {L.scout?.decades && <><span>By decade</span><span>{Object.entries(L.scout.decades).map(([d, n]) => `${d.replace(/^19|^20/, '')} ${n}`).join(' · ')}</span></>}
          {L.lane && <><span>Added today / this week</span><span>{L.lane.today} / {L.lane.week + (L.scout?.week ?? 0)}</span></>}
          {L.lane && Object.keys(L.lane.byDecade).length > 0 && <><span>Added by decade</span><span>{Object.entries(L.lane.byDecade).map(([d, n]) => `${d.slice(2)} ${n}`).join(' · ')}</span></>}
          {L.lane && <><span>Added by source</span><span>{Object.entries(L.lane.byTag).map(([t, n]) => `${t === 'hiphop' ? 'hip hop' : t} ${n}`).join(' · ')}{L.scout ? ` · scout ${L.scout.week}` : ''}</span></>}
          {L.lane && <><span>Masters drive free</span><span className={L.lane.driveFreeGb < 15 ? 'warn' : ''}>{L.lane.driveFreeGb} GB</span></>}
          <span>Fetch on request</span><span title={L.workerAt ?? ''}>{L.workerAt && Date.now() - Date.parse(L.workerAt) < 7 * 86400e3 ? 'on' : 'off'}</span>
          <span>Your plays / likes</span><span>{me.counts.plays} / {me.counts.likes}</span>
        </div>
      </div>
      <AccountCard me={me} save={save} />
      <Install />
      <button className="btn" onClick={() => fetch('/api/logout', { method: 'POST' }).then(() => (location.href = '/login'))}>Sign out {me.name}</button>
    </section>
  );
}

// Add to Home Screen: Android/desktop Chrome get the real prompt; iOS gets the two taps.
function Install() {
  const [mode, setMode] = useState<'none' | 'prompt' | 'ios' | 'installed'>('none');
  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) return setMode('installed');
    if ((window as unknown as { __install?: unknown }).__install) return setMode('prompt');
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) setMode('ios');
  }, []);
  if (mode === 'none' || mode === 'installed') return null;
  return (
    <div className="card">
      <h3>Put 6IAN on your home screen</h3>
      {mode === 'prompt'
        ? <button className="btn primary" onClick={() => (window as unknown as { __install: { prompt: () => void } }).__install.prompt()}>Install</button>
        : <p style={{ margin: 0, color: 'var(--ink-2)' }}>In Safari: Share <span aria-hidden>⎙</span>, then Add to Home Screen.</p>}
    </div>
  );
}

// Who this device is: name, listening style, email link (to recover it elsewhere), claim code.
function AccountCard({ me, save }: { me: Me; save: (b: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const post = (u: string, b: object) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', ...qaHeaders() }, body: JSON.stringify(b) });
  return (
    <div className="card">
      <h3>This device</h3>
      <div className="kv">
        <span>Name</span>
        <span><input className="field" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== me.name && save({ name })} aria-label="Display name" /></span>
        <span>Style</span>
        <span>
          <select value={me.style} onChange={(e) => save({ style: e.target.value })} aria-label="Listening style">
            <option value="home">Library first</option>
            <option value="discovery">Discovery</option>
          </select>
        </span>
        <span>Email</span>
        <span>{me.email ?? 'not linked'}</span>
      </div>
      {!me.email && (
        <form style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 10 }} onSubmit={async (e) => {
          e.preventDefault();
          const r = await post('/api/auth/email', { email });
          const j = await r.json().catch(() => ({}));
          setMsg(r.ok ? 'Check your email for a sign-in link (15 minutes).' : j.error ?? 'Could not send');
        }}>
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email to keep this profile" aria-label="Email" required />
          <button className="btn">Send link</button>
        </form>
      )}
      <form style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 8 }} onSubmit={async (e) => {
        e.preventDefault();
        const r = await post('/api/auth/claim', { code });
        if (r.ok) location.reload(); else setMsg((await r.json().catch(() => ({}))).error ?? 'Could not claim');
      }}>
        <input className="field" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Claim code (from Ian)" aria-label="Claim code" />
        <button className="btn">Claim</button>
      </form>
      {msg && <p style={{ margin: '8px 0 0', color: 'var(--ink-2)' }} role="status">{msg}</p>}
    </div>
  );
}
