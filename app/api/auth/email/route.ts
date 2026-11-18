import { NextResponse } from 'next/server';
import { currentAccount } from '@/lib/auth';
import { newToken } from '@/lib/accounts';
import { reserveCall, CapReached } from '@/lib/voicecap';

// Send a magic link: links this browser's account to the email, or signs in to the account
// already linked to it. Rate-limited per account and globally.
export async function POST(req: Request) {
  const a = await currentAccount();
  if (!a) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return NextResponse.json({ error: 'That doesn’t look like an email address' }, { status: 400 });
  try { await reserveCall(a.id, 'email'); } catch (e) {
    return NextResponse.json({ error: e instanceof CapReached ? 'Too many sign-in emails today' : 'Email is unavailable right now' }, { status: e instanceof CapReached ? 429 : 503 });
  }
  const token = await newToken(email, a.id);
  const link = `${new URL(req.url).origin}/api/auth/verify?t=${token}`;
  if (req.headers.get('x-radio-qa') === '1' && process.env.VERCEL !== '1') return NextResponse.json({ ok: true, link }); // local QA only
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: `6IAN radio <${(process.env.EMAIL_FROM ?? '').replace(/.*<|>.*/g, '')}>`,
      to: [email.trim()],
      subject: 'Your 6IAN sign-in link',
      text: `Tap to sign in to 6IAN on this device (works once, for 15 minutes):\n\n${link}\n\nIf you didn't ask for this, ignore it.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return NextResponse.json({ error: 'Could not send the email' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
