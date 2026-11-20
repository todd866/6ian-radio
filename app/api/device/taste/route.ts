import { NextResponse } from 'next/server';
import { requireAccountOrDevice, noStore, isQa } from '@/lib/http';
import { loadProfile } from '@/lib/profile';
import { space, refreshExtra } from '@/lib/space';

// This account's likes and dislikes (and recent plays) by name, for another player to apply.
export async function GET(req: Request) {
  const a = await requireAccountOrDevice(req);
  if (a instanceof NextResponse) return a;
  await refreshExtra();
  const S = space();
  const p = await loadProfile(a, isQa(req));
  const at = new Map<string, number>();
  for (const e of p.events) if (e.ev === 'like' || e.ev === 'dislike') at.set(`${e.ev}:${e.s}`, e.ts);
  const row = (s: string, ev: string) => { const i = S.bySha.get(s); if (i === undefined) return null; const t = S.tracks[i]; return { s, artist: t.a, title: t.t, album: t.al, key: t.key, at: at.get(`${ev}:${s}`) ?? null }; };
  return NextResponse.json({
    likes: p.likes.map((s) => row(s, 'like')).filter(Boolean),
    dislikes: (p.dislikes ?? []).map((s) => row(s, 'dislike')).filter(Boolean),
    updatedAt: p.updatedAt ?? null,
  }, { headers: noStore });
}
