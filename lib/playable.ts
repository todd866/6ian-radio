import { space } from './space';
import type { MediaInfo } from './media';
import { allowedBy, type Rating } from './rating';
import explicitMap from '../data/explicit.json';

// iOS (every browser there is WebKit) and desktop Safari decode ALAC; Chromium and Firefox don't.
export function uaCanAlac(ua: string) {
  return /iPhone|iPad|iPod/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|Android/.test(ua));
}

// Songs this client can play now: AAC-ready ones always; the rest only where ALAC decodes.
// ...and only songs the listener's rating allows (lib/rating.ts).
export function playableFor(m: Record<string, MediaInfo>, canAlac: boolean, rating: Rating = 'pg') {
  const ts = space().tracks;
  const ok = allowedBy(rating, ts, explicitMap as Record<string, string>);
  return new Set(ts.filter((t) => (canAlac || m[t.s]?.aac) && ok(t)).map((t) => t.s));
}
