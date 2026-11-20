import { NextResponse } from 'next/server';
import { currentAccount, type Account } from './auth';
import { currentDevice, type Principal } from './device';

export async function requireAccount(): Promise<Account | NextResponse> {
  const a = await currentAccount();
  return a ?? NextResponse.json({ error: 'signed out' }, { status: 401 });
}
// Browser session OR a device token: only for the device API, the queue and song info.
// An explicit Authorization header wins: a stale browser cookie must not shadow (or un-revoke)
// the token a device deliberately sent.
export async function requireAccountOrDevice(req?: Request): Promise<Principal | NextResponse> {
  if (!req?.headers.get('authorization')) {
    const a = await currentAccount();
    if (a) return { ...a, via: 'session' };
  }
  const d = await currentDevice();
  if (d) return d;
  const a = await currentAccount();
  return a ? { ...a, via: 'session' } : NextResponse.json({ error: 'signed out' }, { status: 401 });
}

export const noStore = { 'cache-control': 'no-store' };

// A QA request: the page was opened with ?silent=1 (the client adds x-radio-qa: 1).
export function isQa(req: Request) { return req.headers.get('x-radio-qa') === '1'; }
