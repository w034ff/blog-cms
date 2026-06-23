'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { createSession, deleteSession } from '@/lib/session';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

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
  const user = db.select().from(users).where(eq(users.username, username)).get();

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { error: 'ユーザー名またはパスワードが違います。' };
  }

  await createSession({ userId: user.id, username: user.username });
  redirect('/admin');
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect('/login');
}
