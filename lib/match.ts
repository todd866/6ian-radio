// Artist + title (or alias) -> a song on the map, for devices (Glancebar) that know songs by name.
// Consults the shared music/ids.json alias table first (embedMatchKey), then falls back to exact
// normalised artist+title on the loaded map (never a guess).
import { space, refreshExtra } from './space';
import { norm, primary } from './info';
import { loadIds, resolveFromIds } from './store';

let idx: Map<string, string> | null = null;
let size = 0;
const k = (a: string, t: string) => `${norm(primary(a))}|${norm(t)}`;

export async function shaFor(artist: string, title: string, aliases?: { sha?: string; apple?: string; youtube?: string; persistent?: string }): Promise<string | null> {
  await refreshExtra();
  const S = space();
  if (aliases?.sha && S.bySha.has(aliases.sha)) return aliases.sha;
  const ids = await loadIds();
  const hit = resolveFromIds(ids, { ...aliases, artist, title });
  if (hit && S.bySha.has(hit)) return hit;
  if (!idx || size !== S.tracks.length) {
    idx = new Map();
    for (const t of S.tracks) { const key = k(t.a, t.t); if (!idx.has(key)) idx.set(key, t.s); }
    size = S.tracks.length;
  }
  return idx.get(k(artist, title)) ?? null;
}
