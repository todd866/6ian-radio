import { NextResponse } from 'next/server';
import { requireAccount, noStore } from '@/lib/http';
import { space, refreshExtra, dot } from '@/lib/space';
import { media } from '@/lib/media';
import { playableFor, uaCanAlac } from '@/lib/playable';
import { ratingOf } from '@/lib/rating';

// Related: the song's nearest neighbours on the map that this device can play.
export async function GET(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  await refreshExtra();
  const sha = new URL(req.url).searchParams.get('s') ?? '';
  const S = space();
  const i = S.bySha.get(sha);
  if (i === undefined) return NextResponse.json({ tiles: [] });
  const m = await media();
  const playable = playableFor(m, uaCanAlac(req.headers.get('user-agent') ?? ''), ratingOf(req));
  // A find not embedded yet has no neighbour list: songs nearest its stand-in (its artist / station).
  const near = S.tracks[i].n.length ? S.tracks[i].n.map(([j]) => j)
    : S.vec.map((v, j) => [j, dot(v, S.vec[i])] as const).filter(([j]) => j !== i).sort((x, y) => y[1] - x[1]).slice(0, 16).map(([j]) => j);
  const tiles = near.map((j) => S.tracks[j]).filter((t) => playable.has(t.s) && !t.gx).slice(0, 12)
    .map((t) => ({ s: t.s, title: t.t, sub: `${t.a}${t.y ? ` · ${t.y}` : ''}`, art: !!m[t.s]?.art, color: m[t.s]?.color ?? '#444' }));
  return NextResponse.json({ tiles }, { headers: noStore });
}
