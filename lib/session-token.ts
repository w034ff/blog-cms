import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

export type SessionPayload = {
  userId: number;
  username: string;
};

const sessionSchema = z.object({
  userId: z.number(),
  username: z.string(),
});

export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60; // 14 days

export async function encryptSession(payload: SessionPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ userId: payload.userId, username: payload.username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(encodedKey);
}

export async function decryptSession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    const result = sessionSchema.safeParse(payload);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
