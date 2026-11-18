import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sessionId, setSession } from '@/lib/auth';
import { accountForEmail, consumeToken, getAccount, linkEmail, peekToken, saveAccount } from '@/lib/accounts';

// Magic link. In the browser that asked for it: link the email to that account (or sign in to the
// account the email already has). In any other browser: ask "Sign in as <email>?" first, and only
// switch accounts after the listener confirms (POST). Never merges this browser's account silently.
async function finish(t: { email: string; acct: string }, origin: string) {
  let id = await accountForEmail(t.email);
  if (!id) {
    if (await linkEmail(t.email, t.acct)) {
      id = t.acct;
      const a = await getAccount(id);
      if (a) await saveAccount({ ...a, email: t.email });
    } else id = await accountForEmail(t.email);
  }
  if (!id) return NextResponse.redirect(new URL('/login?link=expired', origin), 303);
  await setSession(id);
  return NextResponse.redirect(new URL('/', origin), 303);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const t = await peekToken(token);
  if (!t) return NextResponse.redirect(new URL('/login?link=expired', url.origin));
  if ((await sessionId()) === t.acct) {
    const c = await consumeToken(token).catch(() => null);
    return c ? finish(c, url.origin) : NextResponse.redirect(new URL('/login?link=expired', url.origin));
  }
  // Another browser: confirm first. A nonce cookie (10 min) ties the confirm form to this browser.
  const nonce = crypto.randomBytes(16).toString('base64url');
  (await cookies()).set('mr_confirm', nonce, { httpOnly: true, secure: process.env.VERCEL === '1', sameSite: 'lax', path: '/', maxAge: 600 });
  return NextResponse.redirect(new URL(`/signin?t=${encodeURIComponent(token)}`, url.origin));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  // Cross-site request forgery: only our own pages may post here, with this browser's nonce.
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (!(origin === url.origin || (!origin && site === 'same-origin'))) return new NextResponse('Forbidden', { status: 403 });
  const form = await req.formData().catch(() => null);
  const jar = await cookies();
  const want = jar.get('mr_confirm')?.value;
  const got = String(form?.get('nonce') ?? '');
  if (!want || want.length !== got.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))) return new NextResponse('Forbidden', { status: 403 });
  jar.delete('mr_confirm');
  const c = await consumeToken(String(form?.get('t') ?? '')).catch(() => null);
  return c ? finish(c, url.origin) : NextResponse.redirect(new URL('/login?link=expired', url.origin), 303);
}
