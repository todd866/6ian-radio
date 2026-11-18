import crypto from 'node:crypto';
// Spending guard for voice, in the spirit of md3's: per-account and global daily caps,
// reserved atomically before the provider is called (see counter.ts). Fails closed.
import { capStore } from './r2';
import { reserve, release, CapReached } from './counter';
import { DEFAULT_TZ } from './rules';

export const CAPS = {
  voice: Number(process.env.VOICE_DAILY_CALLS ?? 300), // per account
  tts: Number(process.env.TTS_DAILY_CALLS ?? 150), // per account
  voiceGlobal: Number(process.env.VOICE_GLOBAL_DAILY_CALLS ?? 500),
  ttsGlobal: Number(process.env.TTS_GLOBAL_DAILY_CALLS ?? 250),
  job: Number(process.env.JOB_DAILY ?? 30), // fetch requests per account
  jobGlobal: Number(process.env.JOB_GLOBAL_DAILY ?? 60),
  email: Number(process.env.EMAIL_DAILY ?? 5), // magic links per account
  emailGlobal: Number(process.env.EMAIL_GLOBAL_DAILY ?? 40),
  flag: Number(process.env.FLAG_DAILY ?? 30), // "this is wrong" flags per account
  flagGlobal: Number(process.env.FLAG_GLOBAL_DAILY ?? 300),
};
export { CapReached };

export function today(tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const userKey = (u: string) => `radio/caps/${u}.json`;
const GLOBAL = 'radio/caps/_global.json';

// Reserve one call for this user and globally; returns an undo for a failed provider call.
export async function reserveCall(user: string, kind: 'voice' | 'tts' | 'job' | 'email' | 'flag') {
  const day = today();
  const left = CAPS[kind] - (await reserve(capStore, userKey(user), kind, CAPS[kind], day));
  try {
    await reserve(capStore, GLOBAL, kind, CAPS[(`${kind}Global`) as 'voiceGlobal' | 'ttsGlobal' | 'jobGlobal' | 'emailGlobal' | 'flagGlobal'], day);
  } catch (e) {
    await release(capStore, userKey(user), kind, day);
    throw e;
  }
  return { left, undo: () => Promise.all([release(capStore, userKey(user), kind, day), release(capStore, GLOBAL, kind, day)]) };
}

// The client's IP, from headers only Vercel sets (a client can't forge them there). Locally
// (tests) x-forwarded-for is accepted, since there is no proxy.
export function clientIp(req: Request): string {
  const h = req.headers;
  const v = h.get('x-vercel-forwarded-for') ?? h.get('x-real-ip');
  if (process.env.VERCEL === '1') return (v ?? 'unknown').split(',')[0].trim();
  return (h.get('x-forwarded-for') ?? v ?? 'local').split(',')[0].trim();
}

// Attempts per window, counted BEFORE the secret is checked; fails closed (throws).
const ipKey = (ip: string) => `radio/caps/ip-${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)}.json`;
const window15 = () => `w${Math.floor(Date.now() / 900_000)}`;
export async function countAttempt(kind: 'login' | 'claim', ip: string, account?: string) {
  const cap = kind === 'login' ? 10 : 5;
  await reserve(capStore, ipKey(ip), kind, cap, window15());
  if (account) await reserve(capStore, `radio/caps/${account}-attempts.json`, kind, cap, window15());
}

// "This is wrong" flags per client IP per day (Vercel's trusted IP), on top of the per-account cap.
export const FLAG_IP_DAILY = Number(process.env.FLAG_IP_DAILY ?? 60);
export async function reserveIpFlag(ip: string) {
  const key = `radio/caps/ipflag-${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)}.json`;
  await reserve(capStore, key, 'flag', FLAG_IP_DAILY, today());
}
