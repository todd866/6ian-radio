import fs from 'node:fs';
import path from 'node:path';
import { cachedFact, loadFacts } from './store';

export type Track = {
  s: string; a: string; t: string; al: string; y: number | null; g: string; p: number; f: number;
  k: 'dance' | 'alt' | 'rap' | 'chill'; key: string; x: number; yy: number; c: number;
  e: number; h: number; q: number; n: [number, number][]; v: string;
  nw: 0 | 1; gx?: string; gl?: 1; d?: number; sc?: { src: string; why?: string | null; at?: string; seed?: string | null };
  o?: 1; // his own library (not a find)
  px?: 1; // not embedded yet: placed by its artist / seed / station's songs (no map-neighbour claims)
};
export type Cluster = { id: number; n: number; kind: string; genres: string[]; artists: string[]; x: number; y: number; e: number; h: number };
export type Space = {
  generatedAt: string; dims: number; tracks: Track[]; clusters: Cluster[];
  stats: { tracks: number; embedded: number; catalogue: number; gaps: { embeddedNotInR2: number; inR2NotEmbedded: number } };
};

export type Loaded = Space & { vec: Float32Array[]; bySha: Map<string, number>; clusterName: string[]; lines: Record<string, string> };

let cache: Loaded | null = null;

// Years come only from MusicBrainz: first from unified R2 music/facts.json, falling back to
// bundled data/years.json. Library and file-tag years are never shown.
let YEARS: Record<string, number | null> = {};
export const sourcedYear = (sha: string): number | null => cachedFact(sha)?.year ?? YEARS[sha] ?? null;

function energyWord(e: number) {
  return e > 0.75 ? 'Bright' : e > 0.55 ? 'Driving' : e > 0.35 ? 'Mid-tempo' : 'Slow';
}

export function space(): Loaded {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/space.json'), 'utf8')) as Space;
  try { YEARS = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/years.json'), 'utf8')); } catch { YEARS = {}; }
  for (const t of raw.tracks) t.y = sourcedYear(t.s);
  const vec = raw.tracks.map((t) => {
    const b = Buffer.from(t.v, 'base64');
    const f = new Float32Array(raw.dims);
    let n = 0;
    for (let i = 0; i < raw.dims; i++) { f[i] = (b[i] << 24 >> 24) / 127; n += f[i] * f[i]; }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < raw.dims; i++) f[i] /= n;
    return f;
  });
  const bySha = new Map(raw.tracks.map((t, i) => [t.s, i] as [string, number]));
  // Name each corner after its energy, genre and an artist no other corner is named after.
  const usedArtists = new Set<string>();
  const order = raw.clusters.map((c, i) => i).sort((a, b) => raw.clusters[b].n - raw.clusters[a].n);
  const clusterName: string[] = [];
  for (const i of order) {
    const c = raw.clusters[i];
    const genre = (c.genres[0] || c.kind).replace('Hip-Hop/Rap', 'hip-hop').replace('R&B/Soul', 'soul').toLowerCase();
    const artist = c.artists.find((a) => !usedArtists.has(a)) ?? c.artists[0];
    usedArtists.add(artist);
    clusterName[i] = `${energyWord(c.e)} ${genre} · ${artist}`;
  }
  let lines: Record<string, string> = {};
  try { lines = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/lines.json'), 'utf8')); } catch {}
  cache = { ...raw, vec, bySha, clusterName, lines };
  return cache;
}

// Songs fetched on request since the bundle was built: radio/extra.json, written by the worker
// through /api/worker/tracks. Merged in at runtime (checked at most every 20 s), bundle first.
let extraAt = 0;
const extraShas = new Set<string>();
export async function refreshExtra(force = false): Promise<void> {
  if (!force && Date.now() - extraAt < 20_000) return;
  extraAt = Date.now();
  const S = space();
  const facts = await loadFacts().catch(() => null);
  if (facts?.songs) {
    for (const t of S.tracks) {
      const y = facts.songs[t.s]?.year;
      if (typeof y === 'number') t.y = y;
    }
  }
  const { getJSON } = await import('./r2');
  const ex = await getJSON<{ tracks: (Track & { line?: string })[] }>('radio/extra.json').catch(() => null);
  for (const t of ex?.tracks ?? []) {
    const was = S.bySha.get(t.s);
    if (was !== undefined && !S.tracks[was].px) continue; // a stand-in is replaced by the real embedding
    const b = Buffer.from(t.v, 'base64');
    const f = new Float32Array(S.dims);
    let n = 0;
    for (let i = 0; i < S.dims; i++) { f[i] = (b[i] << 24 >> 24) / 127; n += f[i] * f[i]; }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < S.dims; i++) f[i] /= n;
    t.y = sourcedYear(t.s);
    if (was !== undefined) { S.tracks[was] = t; S.vec[was] = f; } else {
      S.bySha.set(t.s, S.tracks.length);
      S.tracks.push(t);
      S.vec.push(f);
    }
    if (t.line) S.lines[t.s] = t.line;
    extraShas.add(t.s);
  }
  await placeUnembedded(S).catch(() => {});
}

// Finds the home worker lane fetched that have no embedding yet (the $5/day cap): radio/lane-done.json from
// the worker. Each gets a stand-in vector, the centroid of songs by the same artist, else its seed
// artist, else what its station(s) played, so mood and station queues can use it. Marked px: the
// app never claims map nearness for it, and no year or genre is invented (shown blank).
type LaneRow = { sha: string; artist: string; title: string; tag?: string; seed?: string | null; why?: string | null; at?: string };
async function placeUnembedded(S: Loaded) {
  const { getJSON } = await import('./r2');
  const { media } = await import('./media');
  const { stationById } = await import('./stations');
  const { stationsOf } = await import('./source');
  const rows = await getJSON<LaneRow[]>('radio/lane-done.json').catch(() => null);
  if (!rows?.length) return;
  const m = await media();
  const byArtist = new Map<string, number[]>();
  S.tracks.forEach((t, i) => { if (!t.px) { const k = primaryArtist(t.a); (byArtist.get(k) ?? byArtist.set(k, []).get(k)!).push(i); } });
  for (const r of rows) {
    if (!r.sha || S.bySha.has(r.sha) || !m[r.sha]?.aac) continue;
    const sc = { src: r.tag || 'lane', why: r.why ?? null, at: r.at, seed: r.seed ?? null };
    let ix = byArtist.get(primaryArtist(r.artist)) ?? (r.seed ? byArtist.get(primaryArtist(r.seed)) : undefined) ?? [];
    if (!ix.length) for (const id of stationsOf({ sc })) for (const s of stationById(id)?.shas ?? []) { const j = S.bySha.get(s); if (j !== undefined) ix = [...ix, j]; }
    ix = ix.slice(0, 12);
    if (!ix.length) continue; // nothing honest to place it by
    const v = centroid(ix.map((j) => S.vec[j]))!;
    const ts = ix.map((j) => S.tracks[j]);
    const mode = <T,>(xs: T[]) => { const c = new Map<T, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0][0]; };
    const avg = (f: (t: Track) => number) => Math.round((ts.reduce((a, t) => a + f(t), 0) / ts.length) * 1000) / 1000;
    const t: Track = { s: r.sha, a: r.artist, t: r.title, al: '', y: null, g: '', p: 0, f: 0, k: mode(ts.map((x) => x.k)), key: '', x: avg((x) => x.x), yy: avg((x) => x.yy),
      c: mode(ts.map((x) => x.c)), e: avg((x) => x.e), h: avg((x) => x.h), q: avg((x) => x.q), n: [], v: '', nw: 1, sc, px: 1 };
    S.bySha.set(t.s, S.tracks.length);
    S.tracks.push(t);
    S.vec.push(v);
    extraShas.add(t.s);
  }
}

export function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function centroid(vs: Float32Array[]): Float32Array | null {
  if (!vs.length) return null;
  const d = vs[0].length;
  const c = new Float32Array(d);
  for (const v of vs) for (let i = 0; i < d; i++) c[i] += v[i];
  let n = 0;
  for (let i = 0; i < d; i++) n += c[i] * c[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < d; i++) c[i] /= n;
  return c;
}

export function primaryArtist(a: string) {
  return a.toLowerCase().split(/,| & | feat\.? | ft\.? | x /)[0].trim();
}
