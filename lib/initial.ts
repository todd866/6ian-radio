import type { Account } from './auth';
import { buildQueue } from './engine';
import { refreshExtra } from './space';
import { loadProfile } from './profile';
import { media } from './media';
import { present } from './present';
import { playableFor, uaCanAlac } from './playable';
import type { Rating } from './rating';
import { localClock, ruleAt } from './rules';
import { MOODS } from './moods';

const BY_RULE: Record<string, string> = { morning: 'chill', midday: 'alt', afternoon: 'drive', evening: 'alt', late: 'chill' };

export async function initialState(a: Account, ua = '', rating: Rating = 'pg') {
  const [profile, m] = await Promise.all([loadProfile(a), media(), refreshExtra()]);
  const now = new Date();
  const rule = ruleAt(now, profile.tz);
  const mood = a.style === 'discovery' ? 'wide' : BY_RULE[rule.id] ?? 'wide';
  const playable = playableFor(m, uaCanAlac(ua), rating);
  const q = buildQueue({ mood, playable, n: 10 }, profile, now);
  return {
    mood, picks: q.picks.map((p) => present(p, a.id, a.style, mood, m)),
    rule: { id: rule.id, label: rule.label }, clock: localClock(now, profile.tz), tz: profile.tz,
    likes: profile.likes, rating, moods: MOODS.map((x) => ({ id: x.id, label: x.label, freq: x.freq })),
  };
}
export type Initial = Awaited<ReturnType<typeof initialState>>;
