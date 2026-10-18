import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET ?? '');

// The account id alone. Names are read from `users` on each request (lib/dal.ts), because a Google
// author has no username (docs/multi-author-requirements.md §9.2). A cookie issued before this
// carries a `username` too; the schema drops it, so those sessions stay valid.
export type SessionPayload = {
  userId: number;
};

const sessionSchema = z.object({
  userId: z.number(),
});

export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60; // 14 days

export async function encryptSession(payload: SessionPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(encodedKey);
}

export async function decryptSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ['HS256'],
    });
    const result = sessionSchema.safeParse(payload);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
