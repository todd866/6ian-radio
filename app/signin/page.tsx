import { cookies } from 'next/headers';
import { peekToken } from '@/lib/accounts';

// A magic link opened in a different browser: confirm before switching this browser's account.
export default async function SignIn({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = '' } = await searchParams;
  const tok = await peekToken(t);
  const nonce = (await cookies()).get('mr_confirm')?.value ?? '';
  return (
    <main className="login">
      <form method="post" action="/api/auth/verify">
        <div className="call">6<b>IAN</b></div>
        {tok ? (
          <>
            <p className="serif" data-testid="confirm">Sign in as {tok.email}?</p>
            <p>This browser will switch to that profile.</p>
            <input type="hidden" name="t" value={t} />
            <input type="hidden" name="nonce" value={nonce} />
            <button className="btn primary">Sign in</button>
          </>
        ) : <p className="serif">That sign-in link has expired or was already used.</p>}
      </form>
    </main>
  );
}
