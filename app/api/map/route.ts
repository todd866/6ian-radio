import { NextResponse } from 'next/server';
import { requireAccount } from '@/lib/http';
import { space, refreshExtra } from '@/lib/space';

export async function GET() {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  await refreshExtra();
  const S = space();
  return NextResponse.json({
    pts: S.tracks.map((t) => [t.x, t.yy, ['dance', 'alt', 'rap', 'chill'].indexOf(t.k), t.c]),
    shas: S.tracks.map((t) => t.s),
    clusters: S.clusters.map((c, i) => ({ x: c.x, y: c.y, n: c.n, name: S.clusterName[i] })),
  }, { headers: { 'cache-control': 'private, max-age=3600' } });
}
