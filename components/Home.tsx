'use client';
import { useEffect, useRef, useState } from 'react';
import { qaHeaders } from './Radio';

export type StationT = { id: string; name: string; logo?: string; color?: string; live?: string | null; liveType?: 'hls' | 'direct'; shas?: string[]; count?: number };
export type TileT = {
  kind: 'song' | 'mix' | 'station' | 'soon'; s?: string; title: string; sub: string; artist?: string; art: boolean; color: string;
  point?: { x: number; y: number }; mood?: string; logo?: string; station?: StationT;
};
type Shelf = { id: string; title: string; tiles: TileT[] };
type Chip = { id: string; label: string; era?: { from: number; to: number } };

// Square art; the 300 px WebP thumbnail is 2x a 150 px tile. Lazy-loaded, decoded off the main
// thread, and never a grey box: the tile's own colour sits behind it until it arrives.
export function Art({ s, art, color, size, src }: { s: string; art: boolean; color: string; size: number; src?: string }) {
  const [on, setOn] = useState(false);
  const url = src ?? (art ? `/api/art/${s}?size=${size > 160 ? 600 : 300}` : null);
  return (
    <span className="art" style={{ width: size, height: size, background: color }}>
      {url && <img src={url} alt="" loading="lazy" decoding="async" width={size} height={size} className={on ? 'on' : ''} onLoad={() => setOn(true)} />}
    </span>
  );
}

export function Tile({ t, onOpen, onMenu, size = 150 }: { t: TileT; onOpen: (t: TileT) => void; onMenu: (t: TileT) => void; size?: number }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  return (
    <div className="tile" style={{ width: size }} data-testid="tile" data-kind={t.kind}
      onContextMenu={(e) => { e.preventDefault(); onMenu(t); }}
      onPointerDown={() => { long.current = false; timer.current = setTimeout(() => { long.current = true; onMenu(t); }, 550); }}
      onPointerUp={() => { if (timer.current) clearTimeout(timer.current); }}
      onPointerLeave={() => { if (timer.current) clearTimeout(timer.current); }}>
      <button className="tileart" onClick={() => { if (!long.current) onOpen(t); }} aria-label={`Play ${t.title}`}>
        <Art s={t.s ?? ''} art={t.art} color={t.color} size={size} src={t.logo} />
      </button>
      <div className="tiletext">
        <span className="tt">{t.title}</span>
        <button className="dots" onClick={() => onMenu(t)} aria-label={`More for ${t.title}`}>⋯</button>
      </div>
      <span className="ts">{t.sub}</span>
    </div>
  );
}

type Pick = { id: string; label: string; s: string; color: string };
let cache: { chips: Chip[]; shelves: Shelf[]; picker?: Pick[] | null } | null = null;

export function Home({ onChip, onOpen, onMenu }: { onChip: (c: Chip) => void; onOpen: (t: TileT) => void; onMenu: (t: TileT) => void }) {
  const [data, setData] = useState(cache);
  const load = () => fetch('/api/home', { headers: qaHeaders() }).then((r) => r.json()).then((d) => { cache = d; setData(d); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const choose = async (ids: string[]) => {
    await fetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json', ...qaHeaders() }, body: JSON.stringify({ taste: ids }) });
    cache = null; load();
  };
  if (!data) return <div className="homeload" aria-busy="true" />;
  return (
    <div className="shelves">
      {data.picker && data.picker.length > 0 && (
        <section className="picker" aria-label="What do you listen to?">
          <h2>What do you listen to?</h2>
          <div className="shelfrow">
            {data.picker.map((g) => (
              <button key={g.id} className="pick" onClick={() => choose([g.id])} data-testid={`pick-${g.id}`}>
                <Art s={g.s} art color={g.color} size={120} />
                <span>{g.label}</span>
              </button>
            ))}
            <button className="pick" onClick={() => choose(['everything'])} data-testid="pick-everything">
              <span className="art everything" style={{ width: 120, height: 120 }}>All of it</span>
              <span>Everything</span>
            </button>
          </div>
        </section>
      )}
      <div className="chiprow" role="toolbar" aria-label="Moods and decades">
        {data.chips.map((c) => <button key={c.id} onClick={() => onChip(c)} data-testid={`chip-${c.id}`}>{c.label}</button>)}
      </div>
      {data.shelves.filter((s) => s.tiles.length).map((s) => (
        <section key={s.id} className="shelf" aria-label={s.title}>
          <h2>{s.title}</h2>
          <div className="shelfrow">{s.tiles.map((t, i) => <Tile key={`${t.s ?? t.title}-${i}`} t={t} onOpen={onOpen} onMenu={onMenu} />)}</div>
        </section>
      ))}
    </div>
  );
}

type StationPageT = { id: string; name: string; color: string; logo: string | null; live: string | null; liveType: 'hls' | 'direct'; mixSize: number; recent: TileT[]; sound: TileT[]; soon: TileT[] };

// A station: big logo header, Play mix, Listen live, then its shelves.
export function StationPage({ id, onPlay, onLive, onOpen, onMenu, onBack }: {
  id: string; onPlay: (st: StationT) => void; onLive: (st: StationT) => void; onOpen: (t: TileT) => void; onMenu: (t: TileT) => void; onBack: () => void;
}) {
  const [d, setD] = useState<StationPageT | null>(null);
  useEffect(() => { fetch(`/api/station/${id}`, { headers: qaHeaders() }).then((r) => r.json()).then(setD).catch(() => {}); }, [id]);
  if (!d) return <div className="homeload" aria-busy="true" />;
  const st: StationT = { id: d.id, name: d.name, live: d.live, liveType: d.liveType };
  const canLive = !!d.live && (d.liveType !== 'hls' || document.createElement('audio').canPlayType('application/vnd.apple.mpegurl') !== '');
  return (
    <div className="shelves stationpage">
      <header className="sthead" style={{ background: d.color }}>
        <button className="stback" onClick={onBack} aria-label="Back to home">‹</button>
        {d.logo ? <img src={d.logo} alt={d.name} className="stlogo" /> : <h1>{d.name}</h1>}
      </header>
      <div className="stactions">
        <button className="btn primary" onClick={() => onPlay(st)} data-testid="station-play">▶ Play mix</button>
        {canLive && <button className="btn" onClick={() => onLive(st)} data-testid="listen-live">Listen live</button>}
        <span className="stcount">{d.mixSize} songs</span>
      </div>
      {[[`Recently played on ${d.name}`, d.recent], [`${d.name} sound`, d.sound], ['Coming soon', d.soon]].map(([title, tiles]) =>
        (tiles as TileT[]).length ? (
          <section key={title as string} className="shelf" aria-label={title as string}>
            <h2>{title as string}</h2>
            <div className="shelfrow">{(tiles as TileT[]).map((t, i) => <Tile key={`${t.s ?? t.title}-${i}`} t={t} onOpen={onOpen} onMenu={onMenu} />)}</div>
          </section>
        ) : null)}
    </div>
  );
}
