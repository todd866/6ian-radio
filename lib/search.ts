// Library lookup for "play X": strict enough that a near miss is treated as "not in the library"
// (and fetched), never played as the wrong song. "X by Y" must match artist Y; otherwise most of
// the words asked for must be in the title (or title + artist).
import { space } from './space';

export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'by', 'song', 'track', 'some', 'something', 'please', 'me', 'play', 'put', 'on', 'of']);
const words = (s: string) => norm(s).split(' ').filter((w) => w && !STOP.has(w));

export function search(q: string, limit = 5) {
  const S = space();
  const m = /^(.*?)\s+by\s+(.+)$/i.exec(q.trim());
  const wantTitle = words(m ? m[1] : q), wantArtist = m ? words(m[2]) : [];
  const all = [...wantTitle, ...wantArtist];
  if (!all.length) return [];
  const out: { i: number; sc: number }[] = [];
  S.tracks.forEach((t, i) => {
    const tw = new Set(norm(t.t).split(' ')), aw = new Set(norm(t.a).split(' '));
    if (wantArtist.length && !wantArtist.every((w) => aw.has(w))) return;
    const titleHits = wantTitle.filter((w) => tw.has(w)).length;
    const artistHits = wantArtist.length ? wantArtist.length : wantTitle.filter((w) => aw.has(w)).length;
    const titleWords = norm(t.t).split(' ').filter((w) => !STOP.has(w)).length || 1;
    let sc: number;
    if (wantArtist.length) {
      if (!wantTitle.length) sc = 1; // "something by Radiohead": any of theirs
      else sc = titleHits / Math.max(wantTitle.length, titleWords * 0.6);
    } else {
      sc = (titleHits + artistHits) / all.length; // every word asked for is in title or artist
      if (titleHits === 0) sc = artistHits === all.length ? 0.9 : 0; // just an artist name
    }
    if (t.gx) sc -= 0.2;
    if (sc >= 0.8) out.push({ i, sc });
  });
  return out.sort((x, y) => y.sc - x.sc).slice(0, limit);
}
