import type { Metadata } from 'next';
import { LoginForm } from '@/components/LoginForm';

export const metadata: Metadata = { title: 'ログイン' };

export default function LoginPage() {
  return (
    <section className='mx-auto w-full max-w-page'>
      <h1 className='mb-6 text-2xl font-bold tracking-tight'>管理者ログイン</h1>
      <LoginForm />
    </section>
  );
}
