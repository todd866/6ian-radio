import { space } from './space';
import type { MediaInfo } from './media';

// iOS (every browser there is WebKit) and desktop Safari decode ALAC; Chromium and Firefox don't.
export function uaCanAlac(ua: string) {
  return /iPhone|iPad|iPod/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|Android/.test(ua));
}

// Songs this client can play now: AAC-ready ones always; the rest only where ALAC decodes.
export function playableFor(m: Record<string, MediaInfo>, canAlac: boolean) {
  return new Set(space().tracks.filter((t) => canAlac || m[t.s]?.aac).map((t) => t.s));
}
