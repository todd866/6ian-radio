// PG by default; the listener can lift it to M for a few hours (owner, 21 Nov 2026: 6IAN played the
// censored "The Next Episode": "it would be good to have a PG rating I can upgrade for the session").
// Explicitness comes from Apple (tools/explicit.py -> data/explicit.json; the fetch worker stamps new
// songs with xr). 'e' explicit, 'c' Apple's cleaned edit, 'm' both editions match and this file's is
// unknown. PG plays neither 'e' nor 'm'; M plays everything but prefers the explicit edition, so a
// cleaned edit is skipped when the explicit one is in the map.
import { primaryArtist, type Track } from '../vendor/engine/space.ts';

export type Rating = 'pg' | 'm';
export const RATING_COOKIE = 'mr_rating';
export const UPGRADE_SECONDS = 4 * 3600;

// map: data/explicit.json (passed in by lib/playable.ts, so this file stays importable by node tests).
export const explicitnessIn = (map: Record<string, string>) => (t: Track): string | undefined => (t as Track & { xr?: string }).xr ?? map[t.s];

export function ratingFromCookie(header: string | null | undefined): Rating {
  return /(?:^|;\s*)mr_rating=m(?:;|$)/.test(header ?? '') ? 'm' : 'pg';
}
export const ratingOf = (req: Request): Rating => ratingFromCookie(req.headers.get('cookie'));

const songKey = (t: Track) => `${primaryArtist(t.a)}|${t.t.toLowerCase().replace(/\s*[([](feat|ft|with|clean|explicit|edited)[^)\]]*[)\]]/g, '').replace(/[^a-z0-9]+/g, '')}`;

export function allowedBy(rating: Rating, tracks: Track[], map: Record<string, string>): (t: Track) => boolean {
  const explicitness = explicitnessIn(map);
  if (rating === 'pg') return (t) => { const x = explicitness(t); return x !== 'e' && x !== 'm'; };
  const loud = new Set(tracks.filter((t) => { const x = explicitness(t); return x === 'e' || x === 'm'; }).map(songKey));
  return (t) => !(explicitness(t) === 'c' && loud.has(songKey(t)));
}
