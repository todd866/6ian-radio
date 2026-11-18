'use client';
import { useEffect, useState } from 'react';
import type { Presented } from '@/lib/present';

// The cover, or a typeset sleeve in the song's own colour while it decodes or when there is none.
export function Sleeve({ t, big }: { t: Presented; big?: boolean }) {
  const [on, setOn] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setOn(false); setSrc(null);
    if (!t.art) return;
    const url = `/api/art/${t.s}`;
    const img = new Image();
    img.src = url;
    let live = true;
    (img.decode ? img.decode() : Promise.resolve()).then(() => { if (live) { setSrc(url); requestAnimationFrame(() => setOn(true)); } }).catch(() => {});
    return () => { live = false; };
  }, [t.s, t.art]);
  return (
    <div className={big ? 'sleeve' : 'thumb'} style={{ background: t.color }} data-testid={big ? 'sleeve' : undefined}>
      {big && (
        <div className="gen" aria-hidden={!!src}>
          <div className="small" />
          <div className="big">{t.a}</div>
          <div className="small">{t.al}{t.y ? ` · ${t.y}` : ''}</div>
        </div>
      )}
      {src && <img src={src} alt={`${t.al} cover`} className={on ? 'on' : ''} />}
      {big && <span className={`tagline ${t.nw ? 'new' : ''}`} data-testid="tag">{t.tag}</span>}
    </div>
  );
}
