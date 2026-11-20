import { getJSON, putJSON, capStore } from './r2';
import { DEFAULT_TZ } from './rules';
import type { Account } from './auth';

export type Ev = { ts: number; s: string; ev: 'play' | 'skip' | 'like' | 'unlike' | 'finish' | 'more' | 'less' | 'dislike' | 'undislike'; via?: string; src?: 'ai' | 'control'; nw?: number; m?: string; pos?: number };
export type Profile = {
  user: string;
  qa?: boolean;
  style: 'home' | 'discovery';
  tz: string;
  newShare?: number;
  taste?: string[]; // first-run picker: genres this listener chose
  likes: string[];
  dislikes?: string[]; // never play (the thumbs-down button here, or a dislike in Glancebar)
  skips: Record<string, number>;
  heard: Record<string, number>;
  events: Ev[];
  updatedAt?: number;
};

// QA runs (?silent=1) keep their own profile so tests never train or skew a listener's.
const key = (u: string, qa = false) => `radio/profiles/${u}${qa ? '-qa' : ''}.json`;
const MAX_EVENTS = 5000;

export function freshProfile(a: Account): Profile {
  // The mate starts wide, novelty up; nothing is copied from Ian's profile.
  return { user: a.id, style: a.style, tz: DEFAULT_TZ, newShare: a.style === 'discovery' ? 0.75 : 0.6, likes: [], skips: {}, heard: {}, events: [] };
}

export async function loadProfile(a: Account, qa = false): Promise<Profile> {
  const p = await getJSON<Profile>(key(a.id, qa));
  return { ...freshProfile(a), ...(p ?? {}), style: a.style, qa };
}

export async function saveProfile(p: Profile) {
  p.events = p.events.slice(-MAX_EVENTS);
  p.updatedAt = Date.now();
  await putJSON(key(p.user, !!p.qa), p);
}

export function applyEvent(p: Profile, e: Ev) {
  p.events.push(e);
  if (e.ev === 'play') p.heard[e.s] = e.ts;
  if (e.ev === 'like' && !p.likes.includes(e.s)) p.likes.push(e.s);
  if (e.ev === 'like') p.dislikes = (p.dislikes ?? []).filter((s) => s !== e.s);
  if (e.ev === 'dislike') { p.likes = p.likes.filter((s) => s !== e.s); if (!(p.dislikes ?? []).includes(e.s)) p.dislikes = [...(p.dislikes ?? []), e.s]; }
  if (e.ev === 'undislike') p.dislikes = (p.dislikes ?? []).filter((s) => s !== e.s);
  if (e.ev === 'unlike') p.likes = p.likes.filter((s) => s !== e.s);
  if (e.ev === 'skip') p.skips[e.s] = (p.skips[e.s] ?? 0) + 1;
  if (e.ev === 'finish' && p.skips[e.s]) p.skips[e.s] = Math.max(0, p.skips[e.s] - 1);
}

// The scoreboard: like and skip rates of AI picks vs the random control, and new vs library.
export function scoreboard(p: Profile) {
  const byPick = new Map<string, { src: string; nw: number; liked: boolean; skipped: boolean }>();
  let open: string | null = null;
  for (const e of p.events) {
    if (e.ev === 'play' && e.src) { open = `${e.ts}:${e.s}`; byPick.set(open, { src: e.src, nw: e.nw ?? 0, liked: false, skipped: false }); continue; }
    if (!open || !open.endsWith(`:${e.s}`)) continue;
    const r = byPick.get(open)!;
    if (e.ev === 'like') r.liked = true;
    if (e.ev === 'skip') r.skipped = true;
  }
  const rows = [...byPick.values()];
  const rate = (f: (r: (typeof rows)[number]) => boolean) => {
    const xs = rows.filter(f);
    return { n: xs.length, like: xs.length ? xs.filter((r) => r.liked).length / xs.length : null, skip: xs.length ? xs.filter((r) => r.skipped).length / xs.length : null };
  };
  return { ai: rate((r) => r.src === 'ai'), control: rate((r) => r.src === 'control'), new: rate((r) => r.nw === 1), library: rate((r) => r.nw === 0) };
}

// Read-modify-write with a compare-and-swap: on a conflicting write the profile is re-read and
// the change applied again, so two taps at once can't lose an event.
export async function updateProfile(a: Account, qa: boolean, change: (p: Profile) => void, tries = 40): Promise<Profile> {
  const k = key(a.id, qa);
  for (let i = 0; i < tries; i++) {
    const cur = await capStore.get(k);
    const p: Profile = { ...freshProfile(a), ...((cur?.body as unknown as Profile) ?? {}), style: a.style, qa };
    change(p);
    p.events = p.events.slice(-MAX_EVENTS);
    p.updatedAt = Date.now();
    const { qa: _q, ...body } = p;
    void _q;
    if (await capStore.putIf(k, body as unknown as never, cur ? cur.etag : null)) return p;
    await new Promise((r) => setTimeout(r, 10 + Math.random() * Math.min(400, 40 * (i + 1))));
  }
  throw new Error('profile busy');
}
