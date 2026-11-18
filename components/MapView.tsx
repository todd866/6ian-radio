'use client';
import { useEffect, useRef, useState } from 'react';
import type { Presented } from '@/lib/present';

const KC = ['#3d7bd9', '#d9883d', '#c94f6d', '#3da88f'];
type MapData = { pts: [number, number, number, number][]; shas: string[]; clusters: { x: number; y: number; n: number; name: string }[] };
let cache: MapData | null = null;

// The song map: every song in the library, the set's trail through it, tap to tune there.
export function MapView({ past, cur, next, onTune }: { past: Presented[]; cur: Presented | null; next: Presented[]; onTune: (p: { x: number; y: number }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<MapData | null>(cache);
  const [hover, setHover] = useState<string>('');
  useEffect(() => { if (!cache) fetch('/api/map').then((r) => r.json()).then((d) => { cache = d; setData(d); }); }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c || !data) return;
    const draw = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = r.width * dpr; c.height = r.height * dpr;
      const g = c.getContext('2d')!;
      g.scale(dpr, dpr);
      const css = getComputedStyle(document.documentElement);
      const m = 14;
      const X = (x: number) => m + x * (r.width - 2 * m), Y = (y: number) => m + y * (r.height - 2 * m);
      g.globalAlpha = 0.55;
      for (const [x, y, k] of data.pts) { g.fillStyle = KC[k]; g.beginPath(); g.arc(X(x), Y(y), 1.8, 0, 7); g.fill(); }
      g.globalAlpha = 1;
      g.font = '10px ' + css.getPropertyValue('--f-mono');
      g.fillStyle = css.getPropertyValue('--ink-2');
      g.textAlign = 'center';
      for (const cl of data.clusters) if (cl.n > 70) g.fillText(cl.name.split(' · ')[1] ?? cl.name, X(cl.x), Y(cl.y));
      const trail = [...past.slice(-8), ...(cur ? [cur] : []), ...next.slice(0, 6)];
      g.strokeStyle = css.getPropertyValue('--ink'); g.lineWidth = 1.2; g.setLineDash([3, 3]);
      g.beginPath(); trail.forEach((t, i) => (i ? g.lineTo(X(t.x), Y(t.yy)) : g.moveTo(X(t.x), Y(t.yy)))); g.stroke(); g.setLineDash([]);
      for (const t of trail) { g.fillStyle = css.getPropertyValue('--ink'); g.beginPath(); g.arc(X(t.x), Y(t.yy), 3, 0, 7); g.fill(); }
      if (cur) { g.strokeStyle = css.getPropertyValue('--signal'); g.lineWidth = 2.5; g.beginPath(); g.arc(X(cur.x), Y(cur.yy), 8, 0, 7); g.stroke(); }
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(c);
    return () => ro.disconnect();
  }, [data, past, cur, next]);
  const tap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), m = 14;
    const x = (e.clientX - r.left - m) / (r.width - 2 * m), y = (e.clientY - r.top - m) / (r.height - 2 * m);
    if (data) {
      let best = 0, bd = 9;
      data.clusters.forEach((c, i) => { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
      setHover(data.clusters[best].name);
    }
    onTune({ x, y });
  };
  return (
    <section className="map" aria-label="Song map">
      <canvas ref={ref} onClick={tap} aria-label="Song map; tap a region to tune there" data-testid="map" />
      <div className="legend">
        {['Dance', 'Alt', 'Rap', 'Chill'].map((k, i) => <span key={k}><i style={{ background: KC[i] }} />{k}</span>)}
        <span style={{ marginLeft: 'auto' }}>{hover ? `Tuned: ${hover}` : 'Tap to tune there'}</span>
      </div>
    </section>
  );
}
