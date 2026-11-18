import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { currentAccount } from '@/lib/auth';
import { initialState } from '@/lib/initial';
import Radio from '@/components/Radio';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const a = await currentAccount();
  if (!a) redirect('/login');
  const init = await initialState(a, (await headers()).get('user-agent') ?? '');
  return <Radio name={a.name} style={a.style} init={init} />;
}
