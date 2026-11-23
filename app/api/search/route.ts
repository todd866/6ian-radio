import { NextResponse } from 'next/server';
import { requireAccount, noStore } from '@/lib/http';
import { space, refreshExtra } from '@/lib/space';
import { media } from '@/lib/media';
import { playableFor, uaCanAlac } from '@/lib/playable';
import { ratingOf } from '@/lib/rating';
import { norm } from '@/lib/search';

// Search results as art tiles: any word in title or artist, best matches first; ?artist= for an
// artist page. Songs without a cover are left off (art everywhere, never a grey square).
export async function GET(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  await refreshExtra();
  const u = new URL(req.url);
  const q = norm(u.searchParams.get('q') ?? ''), artist = norm(u.searchParams.get('artist') ?? '');
  const S = space();
  const m = await media();
  const playable = playableFor(m, uaCanAlac(req.headers.get('user-agent') ?? ''), ratingOf(req));
  const ws = q.split(' ').filter((w) => w.length > 1);
  const hits = S.tracks.map((t) => {
    if (!playable.has(t.s) || t.gx || !m[t.s]?.art) return null;
    const tt = norm(t.t), ta = norm(t.a);
    if (artist) return ta.split(' ').join(' ').includes(artist) ? { t, sc: 1 } : null;
    const sc = ws.reduce((n, w) => n + (tt.split(' ').includes(w) ? 2 : 0) + (ta.split(' ').includes(w) ? 1.5 : 0), 0);
    return sc > 0 ? { t, sc } : null;
  }).filter(Boolean) as { t: (typeof S.tracks)[number]; sc: number }[];
  hits.sort((x, y) => y.sc - x.sc || (y.t.y ?? 0) - (x.t.y ?? 0));
  const tiles = hits.slice(0, 30).map(({ t }) => ({ kind: 'song', s: t.s, title: t.t, sub: `${t.a}${t.y ? ` · ${t.y}` : ''}`, artist: t.a, art: true, color: m[t.s]?.color ?? '#333' }));
  return NextResponse.json({ tiles }, { headers: noStore });
}
