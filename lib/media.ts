import { getJSON } from './r2';

// radio/media.json is written by the home worker media job: {sha: {dur, color, art, aac}}.
export type MediaInfo = { dur: number; color: string | null; art: boolean; aac: number; r2?: boolean; thumb?: boolean };
let cached: { at: number; m: Record<string, MediaInfo> } | null = null;

export async function media(force = false): Promise<Record<string, MediaInfo>> {
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.m;
  try {
    const [base, extra] = await Promise.all([
      getJSON<Record<string, MediaInfo>>('radio/media.json'),
      getJSON<Record<string, MediaInfo>>('radio/media-extra.json').catch(() => null), // fetched on request
    ]);
    const m: Record<string, MediaInfo> = { ...(base ?? {}) };
    for (const [k, v] of Object.entries(extra ?? {})) m[k] = { ...(v as MediaInfo), ...(m[k] ?? {}), ...(v.thumb ? { thumb: true } : {}), ...(!m[k]?.art && v.art ? { art: true, color: v.color } : {}), ...(v.art === false ? { art: false, thumb: false } : {}) };
    cached = { at: Date.now(), m };
  } catch {
    cached = { at: Date.now(), m: cached?.m ?? {} };
  }
  return cached.m;
}
