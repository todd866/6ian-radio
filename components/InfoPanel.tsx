'use client';
import { useEffect, useRef, useState } from 'react';
import { qaHeaders } from './Radio';

type Row = { k: string; label: string; value: string; src: string; url?: string };
type About = { facts: Row[]; artist?: { summary: string; url: string; title: string } | null };
type Lyrics = { synced?: { t: number; line: string }[]; plain?: string; source?: string; url?: string; geniusUrl: string; flagged?: boolean };

const cache = new Map<string, unknown>();
function useInfo<T>(sha: string, kind: string): T | null | 'error' {
  const k = `${sha}:${kind}`;
  const [v, setV] = useState<T | null | 'error'>((cache.get(k) as T) ?? null);
  useEffect(() => {
    if (cache.has(k)) { setV(cache.get(k) as T); return; }
    setV(null);
    let live = true;
    fetch(`/api/info/${sha}?kind=${kind}`, { headers: qaHeaders() }).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { cache.set(k, d); if (live) setV(d); }).catch(() => live && setV('error'));
    return () => { live = false; };
  }, [k, sha, kind]);
  return v;
}

export function prefetchLyrics(sha: string): Promise<boolean> {
  const k = `${sha}:lyrics`;
  if (cache.has(k)) { const l = cache.get(k) as Lyrics; return Promise.resolve(!!(l.synced?.length || l.plain)); }
  return fetch(`/api/info/${sha}?kind=lyrics`, { headers: qaHeaders() }).then((r) => r.json()).then((l: Lyrics) => { cache.set(k, l); return !!(l.synced?.length || l.plain); }).catch(() => false);
}

// One tap on the flag hides the fact and logs it for correction (POST /api/info/[sha]).
function flag(sha: string, field: string, value: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${sha}:`)) cache.delete(k);
  return fetch(`/api/info/${sha}`, { method: 'POST', headers: { ...qaHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ field, value }) }).catch(() => undefined);
}

function Flag({ sha, field, value, onDone }: { sha: string; field: string; value: string; onDone: () => void }) {
  return <button className="flag" title="This is wrong: hide it and log it for correction" aria-label={`Flag ${value} as wrong`} onClick={() => { flag(sha, field, value); onDone(); }} data-testid="flag">⚑</button>;
}

function Src({ src, url }: { src: string; url?: string }) {
  return url ? <a className="src" href={url} target="_blank" rel="noreferrer" title={`Source: ${src}`}>{src}</a> : <span className="src" title={`Source: ${src}`}>{src}</span>;
}

function Rows({ sha, rows }: { sha: string; rows: Row[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  return (
    <dl className="facts">
      {rows.filter((r) => !gone.has(r.k)).map((r) => (
        <div key={r.k}><dt>{r.label}</dt><dd>{r.value}</dd><Src src={r.src} url={r.url} /><Flag sha={sha} field={r.k} value={r.value} onDone={() => setGone((g) => new Set(g).add(r.k))} /></div>
      ))}
    </dl>
  );
}

export function AboutView({ sha, compact }: { sha: string; compact?: boolean }) {
  const a = useInfo<About>(sha, 'about');
  const [bioGone, setBioGone] = useState(false);
  if (a === null) return <p className="muted">Looking it up…</p>;
  if (a === 'error') return <p className="muted">Couldn’t reach the catalogue just now.</p>;
  const facts = compact ? a.facts.filter((f) => ['album', 'year', 'copyright'].includes(f.k) || f.k.startsWith('with:') || f.k.startsWith('producer:')).slice(0, 6) : a.facts;
  const sentences = a.artist?.summary.split(/(?<=\.)\s+/) ?? [];
  return (
    <div className="about">
      {facts.length ? <Rows sha={sha} rows={facts} /> : <p className="muted">No sure match in the catalogue.</p>}
      {a.artist && !bioGone && (
        <div className="bio">
          <h4>{a.artist.title}<Src src="Wikipedia" url={a.artist.url} /><Flag sha={sha} field="bio" value={a.artist.title} onDone={() => setBioGone(true)} /></h4>
          <p>{compact ? sentences.slice(0, 2).join(' ') : a.artist.summary}</p>
        </div>
      )}
    </div>
  );
}

export function WhyView({ sha }: { sha: string }) {
  const w = useInfo<{ rows: Row[] }>(sha, 'why');
  return (
    <div className="whyinfo">
      {w === null ? <p className="muted">…</p> : w === 'error' ? null : <Rows sha={sha} rows={w.rows} />}
      <AboutView sha={sha} compact />
    </div>
  );
}

export function LyricsView({ sha, pos }: { sha: string; pos: number }) {
  const l = useInfo<Lyrics>(sha, 'lyrics');
  const box = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  const idx = l && l !== 'error' && l.synced ? Math.max(0, l.synced.findIndex((x, i) => pos >= x.t && (i === l.synced!.length - 1 || pos < l.synced![i + 1].t))) : -1;
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    const b = box.current;
    if (el && b) b.scrollTo({ top: el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - b.clientHeight / 3, behavior: 'smooth' });
  }, [idx]);
  if (l === null) return <p className="muted">Finding lyrics…</p>;
  if (l === 'error' || gone || (!l.synced?.length && !l.plain)) return <p className="muted">No lyrics found. <a href={l === 'error' ? '#' : l.geniusUrl} target="_blank" rel="noreferrer">Search Genius</a></p>;
  return (
    <div className="lyrics" ref={box}>
      {l.synced?.length
        ? l.synced.map((x, i) => <p key={i} data-i={i} className={i === idx ? 'on' : i < idx ? 'past' : ''}>{x.line || '♪'}</p>)
        : l.plain!.split('\n').map((x, i) => <p key={i}>{x || ' '}</p>)}
      <p className="sources">Lyrics <Src src="LRCLIB" url={l.url} /> <Flag sha={sha} field="lyrics" value="lyrics" onDone={() => setGone(true)} /></p>
    </div>
  );
}
