import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { currentAccount } from '@/lib/auth';
import { initialState } from '@/lib/initial';
import { ratingFromCookie } from '@/lib/rating';
import Radio from '@/components/Radio';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const a = await currentAccount();
  if (!a) redirect('/login');
  const h = await headers();
  const init = await initialState(a, h.get('user-agent') ?? '', ratingFromCookie(h.get('cookie')));
  return <Radio name={a.name} style={a.style} init={init} />;
}
