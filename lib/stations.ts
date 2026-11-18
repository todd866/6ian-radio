import fs from 'node:fs';
import path from 'node:path';

export type Station = { id: string; name: string; color: string; live: string | null; liveType: 'hls' | 'direct'; logo: boolean; count: number; shas: string[]; played: Record<string, string>; missing?: { artist: string; title: string; plays: number; art: string | null }[] };
let cache: Station[] | null = null;
export function stations(): Station[] {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/stations.json'), 'utf8')).stations; } catch { cache = []; }
  return cache!;
}
export const stationById = (id: string) => stations().find((s) => s.id === id);
