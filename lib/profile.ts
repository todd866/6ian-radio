import { getJSON, putJSON, capStore } from './r2.ts';
import { DEFAULT_TZ } from '../vendor/engine/rules.ts';
import type { Account } from './auth';

export type { Ev, Profile } from '../vendor/engine/profile.ts';
import type { Ev, Profile } from '../vendor/engine/profile.ts';

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

// The unified taste snapshot (music/taste/<listener>/snapshot.json, built by musicstore from the
// taste log of every surface): the queue engine's preferred profile source. Same shape as
// musicstore.build_snapshot; the account's style still wins, as it does for the radio profile.
export type Snapshot = {
  listener: string; tz: string; style: string; newShare: number | null;
  likes: string[]; dislikes: string[]; skips: Record<string, number>; heard: Record<string, number>;
  generatedAt: string;
};

const snapshotKey = (u: string, qa = false) => `music/taste/${u}${qa ? '-qa' : ''}/snapshot.json`;

export function snapshotToProfile(s: Snapshot, a: Account, qa = false): Profile {
  return {
    user: a.id, style: a.style, qa, tz: s.tz, ...(s.newShare != null ? { newShare: s.newShare } : {}),
    likes: s.likes ?? [], dislikes: s.dislikes ?? [], skips: s.skips ?? {}, heard: s.heard ?? {}, events: [],
  };
}

type Getter = (k: string) => Promise<unknown>;

export async function loadQueueProfile(a: Account, qa = false, get: Getter = getJSON): Promise<Profile> {
  const s = (await get(snapshotKey(a.id, qa))) as Snapshot | null;
  if (s) return snapshotToProfile(s, a, qa);
  const p = (await get(key(a.id, qa))) as Profile | null;
  return { ...freshProfile(a), ...(p ?? {}), style: a.style, qa };
}

// Write-through: after an event lands in the radio profile, refresh the snapshot from it so
// the queue (and the Macs, until musicstore's next sync rebuilds from the full log) sees it.
// The snapshot is MERGED with what is already there: musicstore folds taste from every surface
// (TV, Glancebar spools) into it, and a plain overwrite from the radio-only profile would
// erase all of that between syncs. Union the sets, keep the max skip count and heard time.
export async function writeSnapshotFromProfile(p: Profile): Promise<void> {
  if (p.qa) return; // a QA run never trains anything real
  const k = snapshotKey(p.user);
  const prev = (await getJSON<Snapshot>(k)) ?? null;
  const body: Snapshot = {
    listener: p.user, tz: p.tz, style: p.style, newShare: p.newShare ?? null,
    likes: [...new Set([...(prev?.likes ?? []), ...p.likes])],
    dislikes: [...new Set([...(prev?.dislikes ?? []), ...(p.dislikes ?? [])])],
    skips: { ...(prev?.skips ?? {}), ...Object.fromEntries(Object.entries(p.skips).map(([s, n]) => [s, Math.max(n, prev?.skips?.[s] ?? 0)])) },
    heard: { ...(prev?.heard ?? {}), ...p.heard },
    generatedAt: new Date().toISOString(),
  };
  await putJSON(k, body);
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
