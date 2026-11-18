import { NextResponse } from 'next/server';
import { sessionId, setSession, sitePasswordOk } from '@/lib/auth';
import { createAccount, getAccount } from '@/lib/accounts';
import { countAttempt, clientIp, CapReached } from '@/lib/voicecap';

// The site gate: one shared password. Past it, this browser keeps its account (or gets a new one).
export async function POST(req: Request) {
  // Every attempt is counted before the password is checked (10 per IP per 15 minutes).
  try { await countAttempt('login', clientIp(req)); } catch (e) {
    return e instanceof CapReached
      ? NextResponse.json({ error: 'Too many tries. Wait 15 minutes.' }, { status: 429 })
      : NextResponse.json({ error: 'Sign-in is unavailable right now. Try again shortly.' }, { status: 503 });
  }
  const { pass, name } = (await req.json().catch(() => ({}))) as { pass?: string; name?: string };
  if (!pass || !sitePasswordOk(pass)) return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  const existing = await sessionId();
  let acct = existing ? await getAccount(existing).catch(() => null) : null;
  if (!acct) acct = await createAccount(typeof name === 'string' ? name : '', req.headers.get('x-radio-qa') === '1');
  await setSession(acct.id);
  return NextResponse.json({ ok: true, name: acct.name });
}
