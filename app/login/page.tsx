import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/auth';
import LoginForm from './form';

export default async function Login() {
  if (await currentAccount()) redirect('/');
  return <LoginForm />;
}
