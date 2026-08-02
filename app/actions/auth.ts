'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { createSession, deleteSession } from '@/lib/session';
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from '@/lib/login-throttle';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Compared against when the username doesn't exist, so both outcomes cost the same
// bcrypt work. Without it the miss returns in microseconds and the hit takes ~250ms,
// which answers "is this a real account?" for anyone with a stopwatch. A real hash
// of a value nobody holds — it is not a secret, and generating one at startup would
// spend the same 250ms on every boot to arrive at the same behaviour.
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
  // Always hashes, even for a username that doesn't exist — see ABSENT_USER_HASH.
  // Awaited rather than compareSync: the comparison is ~250ms of pure computation
  // and Node serves everything else on the same thread, so the synchronous form
  // stalled the whole site for the duration of every login attempt.
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? ABSENT_USER_HASH);

  if (!user || !passwordMatches) {
    const failures = recordLoginFailure(username);
    // The only record that an attempt happened at all; without it a run against
    // this endpoint leaves nothing behind to notice.
    console.warn(`login failed for "${username}" (${failures} consecutive)`);
    return { error: 'ユーザー名またはパスワードが違います。' };
  }

  clearLoginFailures(username);
  await createSession({ userId: user.id, username: user.username });
  redirect('/admin');
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect('/login');
}
