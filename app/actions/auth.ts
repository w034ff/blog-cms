'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { createSession, deleteSession } from '@/lib/session';
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from '@/lib/login-throttle';
import { SUSPENDED_MESSAGE } from '@/lib/google-login-errors';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Compared against for an unknown username, so a miss costs the same ~250ms bcrypt work as a hit
// and timing does not reveal real accounts. A hash of a value nobody holds, so not a secret.
const ABSENT_USER_HASH = '$2b$12$/PAuBnp8Q0XxExbEa87ws.gNZOfmm0XrLxj0okKDCwfJ0L1cIRdAC';

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'ユーザー名とパスワードを入力してください。' };
  }

  const { username, password } = parsed.data;

  const verdict = checkLoginAllowed(username);
  if (!verdict.allowed) {
    return {
      error: `試行が続いたため一時的に制限しています。${verdict.retryAfterSeconds}秒後に再試行してください。`,
    };
  }

  const user = db.select().from(users).where(eq(users.username, username)).get();
  // Always hashes (see ABSENT_USER_HASH). Async, not compareSync: ~250ms on the only thread would
  // stall the whole site on every login attempt.
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? ABSENT_USER_HASH);

  if (!user || !passwordMatches) {
    const failures = recordLoginFailure(username);
    // The only record that an attempt happened at all.
    console.warn(`login failed for "${username}" (${failures} consecutive)`);
    return { error: 'ユーザー名またはパスワードが違います。' };
  }

  if (user.suspendedAt !== null) {
    return { error: SUSPENDED_MESSAGE };
  }

  clearLoginFailures(username);
  await createSession({ userId: user.id });
  redirect('/admin');
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect('/login');
}
