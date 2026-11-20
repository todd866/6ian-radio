import { NextResponse } from 'next/server';
import { requireAccount, noStore, isQa } from '@/lib/http';
import { space, refreshExtra, primaryArtist, type Track } from '@/lib/space';
import { loadProfile } from '@/lib/profile';
import { media } from '@/lib/media';
import { buildQueue, isNew } from '@/lib/engine';
import { playableFor, uaCanAlac } from '@/lib/playable';
import { chipsFor } from '@/lib/present';
import { GENRES, WU, UNDERGROUND } from '@/lib/genres';
import { stations } from '@/lib/stations';
import { stationsOf } from '@/lib/source';

// Home: shelves of square tiles. A song tile plays that song (the set continues around it);
// a mix tile starts a mood, a corner of the map or a decade.
type Tile = { kind: 'song' | 'mix' | 'station'; s?: string; artist?: string; logo?: string; station?: unknown; title: string; sub: string; art: boolean; color: string; mood?: string; era?: { from: number; to: number }; point?: { x: number; y: number } };

export async function GET(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  await refreshExtra();
  const [p, m] = await Promise.all([loadProfile(a, isQa(req)), media()]);
  const S = space();
  const playable = playableFor(m, uaCanAlac(req.headers.get('user-agent') ?? ''));
  const ok = (t: Track) => playable.has(t.s) && !t.gx && !!m[t.s]?.art; // no cover, no tile
  const color = (t: Track) => m[t.s]?.color ?? `hsl(${parseInt(t.s.slice(0, 4), 16) % 360} 40% 35%)`;
  const songTile = (t: Track): Tile => ({ kind: 'song', s: t.s, title: t.t, sub: `${t.a}${t.y ? ` · ${t.y}` : ''}`, artist: t.a, art: !!m[t.s]?.art, color: color(t) });
  const seed = Math.floor(Date.now() / 3600e3); // shelves change hourly, not on every visit
  const shuffle = <T,>(xs: T[]) => xs.map((x, i) => [x, Math.sin(seed * 9301 + i * 49297) ] as const).sort((x, y) => x[1] - y[1]).map(([x]) => x);
  const newFirst = (ts: Track[]) => [...shuffle(ts.filter((t) => isNew(t, p))), ...shuffle(ts.filter((t) => !isNew(t, p)))]; // discovery first (owner, 19 Nov)
  const oneEach = (ts: Track[], n: number) => { const seen = new Set<string>(); const out: Track[] = []; for (const t of ts) { const k = primaryArtist(t.a); if (!seen.has(k)) { seen.add(k); out.push(t); } if (out.length >= n) break; } return out; };

  const quick = buildQueue({ mood: 'wide', playable: new Set([...playable].filter((x) => m[x]?.art)), n: 12 }, p, new Date(), seed).picks.map((x) => songTile(S.tracks[x.i]));
  const mixes: Tile[] = S.clusters.slice().sort((x, y) => y.n - x.n).slice(0, 10).map((c, i) => {
    const members = S.tracks.filter((t) => t.c === S.clusters.indexOf(c) && ok(t) && m[t.s]?.art);
    const cover = members[0] ?? S.tracks.find((t) => t.c === S.clusters.indexOf(c))!;
    if (!members.length) return null;
    return { kind: 'mix', title: `${S.clusterName[S.clusters.indexOf(c)].split(' · ')[1]} mix`, sub: S.clusterName[S.clusters.indexOf(c)].split(' · ')[0], art: !!m[cover.s]?.art, s: cover.s, color: color(cover), point: { x: c.x, y: c.y }, mood: `mix-${i}` } as Tile;
  }).filter((x): x is Tile => !!x);
  const fresh = oneEach(shuffle(S.tracks.filter((t) => ok(t) && (t.sc || isNew(t, p)))), 12).map(songTile);
  const library = oneEach(shuffle(S.tracks.filter((t) => ok(t) && t.o && (t.f || t.p > 0))), 12).map(songTile);
  const decades = [1960, 1970, 1980, 1990, 2000, 2010, 2020].map((d) => ({ d, ts: oneEach(newFirst(S.tracks.filter((t) => ok(t) && t.y && t.y >= d && t.y < d + 10)), 12) })).filter((x) => x.ts.length >= 4);

  const isRap = (t: Track) => t.k === 'rap' || /hip-hop|rap/i.test(t.g);
  const hiphop = oneEach(newFirst(S.tracks.filter((t) => ok(t) && isRap(t))), 14).map(songTile);
  const wu = shuffle(S.tracks.filter((t) => ok(t) && WU.test(t.a))).slice(0, 14).map(songTile);
  const golden = oneEach(newFirst(S.tracks.filter((t) => ok(t) && isRap(t) && t.y && t.y >= 1988 && t.y <= 1998)), 14).map(songTile);
  const under = oneEach(newFirst(S.tracks.filter((t) => ok(t) && UNDERGROUND.test(t.a) && (t.y ?? 0) >= 2010)), 14).map(songTile);
  const rapFirst = (p.taste ?? []).includes('hiphop');
  const rapShelves = [
    ...(hiphop.length >= 4 ? [{ id: 'hiphop', title: 'Hip hop', tiles: hiphop }] : []),
    ...(wu.length >= 4 ? [{ id: 'wu', title: 'Wu-Tang & friends', tiles: wu }] : []),
    ...(golden.length >= 4 ? [{ id: 'golden', title: "Golden era '88–'98", tiles: golden }] : []),
    ...(under.length >= 4 ? [{ id: 'under', title: 'Underground now', tiles: under }] : []),
  ];
  // The first-run picker: one tile per genre, with a cover from that genre.
  const picker = !p.taste && !p.events.length ? GENRES.map((g) => {
    const t = S.tracks.find((x) => ok(x) && g.member(x) && (x.f || x.p > 0)) ?? S.tracks.find((x) => ok(x) && g.member(x));
    return t ? { id: g.id, label: g.label, s: t.s, color: color(t) } : null;
  }).filter(Boolean) : null;
  const finds = (id: string) => S.tracks.filter((t) => t.nw && stationsOf(t).includes(id)).length;
  const stationTiles: Tile[] = stations().filter((st) => st.count > 0 || st.live || finds(st.id)).map((st) => ({
    kind: 'station', title: st.name, sub: finds(st.id) ? `${finds(st.id)} new to you` : st.count ? `${Math.min(400, st.count * 2)} songs` : 'Live', art: st.logo, color: st.color,
    logo: st.logo ? `/api/station-logo/${st.id}` : undefined,
    station: { id: st.id, name: st.name, live: st.live, liveType: st.liveType, count: st.count },
  }));
  const shelves = [
    ...(rapFirst ? rapShelves : []),
    { id: 'quick', title: 'Quick picks', tiles: quick },
    ...(stationTiles.length ? [{ id: 'stations', title: 'Stations', tiles: stationTiles }] : []),
    { id: 'mixed', title: 'Mixed for you', tiles: mixes },
    ...(fresh.length ? [{ id: 'new', title: 'New finds', tiles: fresh }] : []),
    ...(library.length ? [{ id: 'library', title: a.style === 'discovery' ? "From Ian's library" : 'From your library', tiles: library }] : []),
    ...(rapFirst ? [] : rapShelves),
    ...decades.map(({ d, ts }) => ({ id: `d${d}`, title: `${String(d).slice(2)}s`, era: { from: d, to: d + 9 }, tiles: ts.map(songTile) })),
  ];
  const chips = [
    ...['chill', 'energise', 'hiphop', 'focus', 'workout', 'party'].map((id) => ({ id, label: id === 'hiphop' ? 'Hip hop' : id[0].toUpperCase() + id.slice(1) })),
    ...decades.map(({ d }) => ({ id: `era-${d}`, label: `${String(d).slice(2)}s`, era: { from: d, to: d + 9 } })),
  ];
  void chipsFor;
  return NextResponse.json({ chips, shelves, picker }, { headers: noStore });
}
