import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { getOptionalSession } from '@/lib/dal';
import { googleClient } from '@/lib/google-oidc';
import { googleLoginErrorMessage } from '@/lib/google-login-errors';

export const metadata: Metadata = { title: 'ログイン' };

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Through the database, so a suspended author's still-valid cookie gets the form rather than a
  // bounce back to /admin (docs/multi-author-requirements.md §5).
  if (await getOptionalSession()) redirect('/admin');
  const { error } = await searchParams;
  const errorMessage = googleLoginErrorMessage(error);
  const showGoogle = googleClient() !== null;

  return (
    <section className='mx-auto w-full max-w-page'>
      <h1 className='mb-6 text-2xl font-bold tracking-tight'>ログイン</h1>
      <LoginForm showGoogle={showGoogle} errorMessage={errorMessage} />
    </section>
  );
}
