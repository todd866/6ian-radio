'use client';
import type { Presented } from '@/lib/present';
import { Icon } from './Icon';

const KC: Record<string, string> = { dance: '#3d7bd9', alt: '#d9883d', rap: '#c94f6d', chill: '#3da88f' };

// The set: the energy arc across the last 5 and next 10, then the running order.
export function SetView({ past, cur, next }: { past: Presented[]; cur: Presented | null; next: Presented[] }) {
  const p = past.slice(-5);
  const items = [...p, ...(cur ? [cur] : []), ...next.slice(0, 10)];
  const ci = p.length;
  const W = 340, H = 80, pad = 10;
  const xs = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, items.length - 1);
  const ys = (e: number) => H - pad - e * (H - 2 * pad);
  const path = items.map((t, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(t.e).toFixed(1)}`).join(' ');
  return (
    <section className="set" aria-label="The set">
      <svg className="arc" viewBox={`0 0 ${W} ${H + 12}`} preserveAspectRatio="none" role="img" aria-label="Energy across the set">
        <text x={pad} y={10} fontSize="9" fill="var(--ink-3)">energy</text>
        <line x1={xs(ci)} x2={xs(ci)} y1={4} y2={H} stroke="var(--line)" strokeWidth="1" />
        <path d={path} fill="none" stroke="var(--ink-2)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        {items.map((t, i) => (
          <g key={t.pt}>
            <circle cx={xs(i)} cy={ys(t.e)} r={i === ci ? 5 : 3.2} fill={KC[t.k]} stroke={i === ci ? 'var(--ink)' : 'none'} strokeWidth="1.5" opacity={i < ci ? 0.5 : 1} />
            {t.turn && <text x={xs(i)} y={H + 10} fontSize="9" textAnchor="middle" fill="var(--signal)">turn</text>}
          </g>
        ))}
      </svg>
      <div className="rows">
        {items.map((t, i) => (
          <div key={t.pt} className={`row ${i === ci ? 'cur' : i < ci ? 'past' : ''}`}>
            <span className="ix num">{i === ci ? '▶' : i < ci ? `−${ci - i}` : `+${i - ci}`}</span>
            <span className="thumb" style={{ background: t.color }}>{t.art && <img src={`/api/art/${t.s}`} alt="" loading="lazy" />}</span>
            <span className="tt"><b>{t.t}</b><span>{t.a} · {t.turn ? <><Icon n="turn" size={10} /> </> : null}{t.reasons[0]}</span></span>
            <span className="en"><span>{t.nw ? 'new' : 'lib'}</span><i><b style={{ width: `${Math.round(t.e * 100)}%` }} /></i></span>
          </div>
        ))}
      </div>
    </section>
  );
}
