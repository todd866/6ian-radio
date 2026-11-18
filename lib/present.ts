import { space } from './space';
import type { Pick } from './engine';
import type { MediaInfo } from './media';
import { pickToken } from './auth';
import { stationById } from './stations';

const KIND_HUE: Record<string, number> = { dance: 215, alt: 28, rap: 345, chill: 165 };
// A sleeve colour for songs with no cover yet: the kind's hue, nudged per song so cards differ.
function fallbackColor(sha: string, kind: string, energy: number) {
  const n = parseInt(sha.slice(0, 6), 16);
  const hue = (KIND_HUE[kind] + ((n % 60) - 30) + 360) % 360;
  return `hsl(${hue} ${42 + (n % 25)}% ${30 + Math.round(energy * 18)}%)`;
}

export function tagFor(p: Pick, style: string) {
  const t = space().tracks[p.i];
  if (p.nw) {
    if (t.sc?.src === 'triplej') return 'new: heard on triple j';
    if (t.sc?.src === 'shazam') return 'new: from a Shazam';
    if (t.sc?.src === 'request') return 'new: just fetched';
    if (t.sc?.src?.startsWith('radio:')) return `new: heard on ${t.sc.src.slice(6).toUpperCase()}`;
    if (t.sc) return 'new: a scout find';
    return 'new: never played';
  }
  return style === 'discovery' ? "from Ian's library" : 'from your library';
}

const KIND_LABEL: Record<string, string> = { dance: 'Dance', alt: 'Alternative', rap: 'Hip-hop', chill: 'Chill' };

// Short facts for the card: where it came from, the year, the mood. No prose.
export function chipsFor(t: ReturnType<typeof space>['tracks'][number], nw: number, style: string): string[] {
  const src = t.sc?.src;
  const source = src === 'request' ? 'Just fetched' : src?.startsWith('radio:') ? src.slice(6).toUpperCase().replace('6MUSIC', '6 Music') : src === 'triplej' ? 'triple j' : src === 'shazam' ? 'Shazam' : src ? 'New find' : nw ? 'New to you' : style === 'discovery' ? "Ian's library" : 'Your library';
  const mood = t.h > 0.8 ? 'Heavy' : t.e > 0.8 ? 'High energy' : t.e < 0.25 ? 'Mellow' : KIND_LABEL[t.k];
  return [source, t.y ? String(t.y) : '', mood].filter(Boolean);
}

// On a station's mix, the first chip says when the station played it: "KEXP · played 12 Nov".
function stationChips(sha: string, mood: string, chips: string[]) {
  if (!mood.startsWith('station:')) return chips;
  const st = stationById(mood.slice(8));
  if (!st) return chips;
  const d = st.played[sha];
  if (!d) return [`${st.name}-ish`, ...chips.slice(1)]; // a neighbour of the station's sound
  const when = new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return [`${st.name} · played ${when}`, ...chips.slice(1)];
}

export function present(p: Pick, user: string, style: string, mood: string, m: Record<string, MediaInfo>) {
  const S = space();
  const t = S.tracks[p.i];
  const info = m[t.s];
  return {
    s: t.s, a: t.a, t: t.t, al: t.al, y: t.y, g: t.g, k: t.k, c: t.c, cn: S.clusterName[t.c], e: t.e, h: t.h,
    x: t.x, yy: t.yy, nw: p.nw, tag: tagFor(p, style), chips: stationChips(t.s, mood, chipsFor(t, p.nw, style)), reasons: p.reasons, line: p.line, turn: p.turn,
    dur: info?.dur ?? 0, color: info?.color ?? fallbackColor(t.s, t.k, t.e), art: !!info?.art, aac: !!info?.aac,
    pt: pickToken(user, t.s, p.src, p.nw, mood),
  };
}
export type Presented = ReturnType<typeof present>;
