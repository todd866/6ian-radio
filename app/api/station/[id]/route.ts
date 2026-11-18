import { NextResponse } from 'next/server';
import { requireAccount, noStore } from '@/lib/http';
import { space, refreshExtra, centroid, dot } from '@/lib/space';
import { media } from '@/lib/media';
import { playableFor, uaCanAlac } from '@/lib/playable';
import { stationById } from '@/lib/stations';

// A station page: recently played (songs we have), the station's sound (library songs nearest the
// centroid of what it played), and coming soon (its top plays we don't have yet, being fetched).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const st = stationById((await ctx.params).id);
  if (!st) return new NextResponse(null, { status: 404 });
  await refreshExtra();
  const S = space();
  const m = await media();
  const playable = playableFor(m, uaCanAlac(req.headers.get('user-agent') ?? ''));
  const ok = (s: string) => playable.has(s) && !!m[s]?.art && !S.tracks[S.bySha.get(s)!]?.gx;
  const tile = (s: string) => { const t = S.tracks[S.bySha.get(s)!]; return { kind: 'song', s, title: t.t, sub: `${t.a}${st.played[s] ? ` · ${new Date(`${st.played[s]}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : t.y ? ` · ${t.y}` : ''}`, artist: t.a, art: true, color: m[s]?.color ?? st.color }; };
  const members = st.shas.filter((s) => S.bySha.has(s));
  const recent = members.filter(ok).slice(0, 20).map(tile);
  let sound: ReturnType<typeof tile>[] = [];
  const c = centroid(members.map((s) => S.vec[S.bySha.get(s)!]));
  if (c) {
    const set = new Set(members);
    sound = S.tracks.map((t, i) => [t.s, dot(S.vec[i], c)] as const).filter(([s]) => !set.has(s) && ok(s))
      .sort((x, y) => y[1] - x[1]).slice(0, 20).map(([s]) => tile(s));
  }
  const soon = (st.missing ?? []).filter((x) => x.art).slice(0, 20).map((x) => ({ kind: 'soon', title: x.title, sub: `${x.artist} · ${x.plays} play${x.plays === 1 ? '' : 's'}`, artist: x.artist, art: true, logo: x.art, color: st.color }));
  return NextResponse.json({
    id: st.id, name: st.name, color: st.color, logo: st.logo ? `/api/station-logo/${st.id}` : null, live: st.live, liveType: st.liveType,
    mixSize: Math.min(400, members.length * 2), recent, sound, soon,
  }, { headers: noStore });
}
