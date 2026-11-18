import fs from 'node:fs';
import path from 'node:path';

export type Track = {
  s: string; a: string; t: string; al: string; y: number | null; g: string; p: number; f: number;
  k: 'dance' | 'alt' | 'rap' | 'chill'; key: string; x: number; yy: number; c: number;
  e: number; h: number; q: number; n: [number, number][]; v: string;
  nw: 0 | 1; gx?: string; gl?: 1; d?: number; sc?: { src: string; why?: string; at?: string };
};
export type Cluster = { id: number; n: number; kind: string; genres: string[]; artists: string[]; x: number; y: number; e: number; h: number };
export type Space = {
  generatedAt: string; dims: number; tracks: Track[]; clusters: Cluster[];
  stats: { tracks: number; embedded: number; catalogue: number; gaps: { embeddedNotInR2: number; inR2NotEmbedded: number } };
};

export type Loaded = Space & { vec: Float32Array[]; bySha: Map<string, number>; clusterName: string[]; lines: Record<string, string> };

let cache: Loaded | null = null;

// Years come only from MusicBrainz (tools/years.py -> data/years.json): the original release. A song
// not yet checked, or with no sure match, has no year; library and file-tag years are never shown.
let YEARS: Record<string, number | null> = {};
export const sourcedYear = (sha: string): number | null => YEARS[sha] ?? null;

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
  const { getJSON } = await import('./r2');
  const ex = await getJSON<{ tracks: (Track & { line?: string })[] }>('radio/extra.json').catch(() => null);
  for (const t of ex?.tracks ?? []) {
    if (S.bySha.has(t.s) || extraShas.has(t.s)) continue;
    const b = Buffer.from(t.v, 'base64');
    const f = new Float32Array(S.dims);
    let n = 0;
    for (let i = 0; i < S.dims; i++) { f[i] = (b[i] << 24 >> 24) / 127; n += f[i] * f[i]; }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < S.dims; i++) f[i] /= n;
    S.bySha.set(t.s, S.tracks.length);
    t.y = sourcedYear(t.s);
    S.tracks.push(t);
    S.vec.push(f);
    if (t.line) S.lines[t.s] = t.line;
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
