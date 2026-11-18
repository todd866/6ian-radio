import { NextResponse } from 'next/server';
import { currentAccount, setSession } from '@/lib/auth';
import { consumeClaim } from '@/lib/accounts';
import { countAttempt, clientIp, CapReached } from '@/lib/voicecap';

// Claim a migrated profile (the original "mate" account) with its one-time code.
export async function POST(req: Request) {
  const a = await currentAccount();
  if (!a) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  try { await countAttempt('claim', clientIp(req), a.id); } catch (e) {
    return NextResponse.json({ error: e instanceof CapReached ? 'Too many tries. Wait 15 minutes.' : 'Unavailable right now' }, { status: e instanceof CapReached ? 429 : 503 });
  }
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code || code.length > 64) return NextResponse.json({ error: 'No code' }, { status: 400 });
  const id = await consumeClaim(code).catch(() => null);
  if (!id) return NextResponse.json({ error: 'That code is wrong or already used' }, { status: 400 });
  await setSession(id);
  return NextResponse.json({ ok: true });
}
