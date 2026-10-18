import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { siteOrigin } from '@/lib/site';

// Google's OpenID Connect endpoints, written out rather than read from the discovery document: one
// fewer request per sign-in, and they have been stable for years. The issuer has two spellings.
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SCOPE = 'openid email profile';

export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

// A token request that hangs would hold the callback open with the user on Google's redirect.
const TOKEN_TIMEOUT_MS = 10_000;

// Fetched lazily and cached by jose, which also refetches when Google rotates its keys.
const googleKeys = createRemoteJWKSet(new URL(JWKS_URL));

export type GoogleClient = { clientId: string; clientSecret: string; redirectUri: string };

// The OAuth client, or null when either variable is unset: then Google sign-in does not exist on
// this host (docs/multi-author-requirements.md §9.3), as in development and the E2E harness. The
// redirect URI follows SITE_ORIGIN so a move of host cannot leave a second copy behind (§9.1).
export function googleClient(): GoogleClient | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: new URL(GOOGLE_CALLBACK_PATH, siteOrigin).toString(),
  };
}

// What the authorization request leaves in a cookie for the callback to check.
export type AuthRequest = { state: string; nonce: string; codeVerifier: string };

const authRequestSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
});

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newAuthRequest(): AuthRequest {
  return { state: randomToken(), nonce: randomToken(), codeVerifier: randomToken() };
}

export function encodeAuthRequest(request: AuthRequest): string {
  return Buffer.from(JSON.stringify(request)).toString('base64url');
}

export function decodeAuthRequest(value: string | undefined): AuthRequest | null {
  if (!value) return null;
  try {
    const parsed = authRequestSchema.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function authorizationUrl(client: GoogleClient, request: AuthRequest): URL {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state: request.state,
    nonce: request.nonce,
    code_challenge: createHash('sha256').update(request.codeVerifier).digest('base64url'),
    code_challenge_method: 'S256',
    // Lets someone signed in to several Google accounts choose the invited one.
    prompt: 'select_account',
  }).toString();
  return url;
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

// Trades the authorization code for the ID token. Throws on any failure: the callback answers
// every one of them the same way (`failed`).
export async function exchangeCode(
  client: GoogleClient,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`token endpoint answered ${response.status}`);
  return tokenResponseSchema.parse(await response.json()).id_token;
}

export type GoogleClaims = { sub: string; email: string; name: string };

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.boolean(),
  nonce: z.string(),
  name: z.string().optional(),
});

export type IdTokenResult =
  { ok: true; claims: GoogleClaims } | { ok: false; reason: 'failed' | 'unverified' };

// Checks the ID token's signature against Google's keys, its issuer, audience, expiry and nonce,
// and that Google has verified the address (§9.3). `keys` is for tests.
export async function verifyIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
  keys: JWTVerifyGetKey = googleKeys,
): Promise<IdTokenResult> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: ISSUERS,
      audience: expected.clientId,
      algorithms: ['RS256'],
    }));
  } catch {
    return { ok: false, reason: 'failed' };
  }
  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success || parsed.data.nonce !== expected.nonce)
    return { ok: false, reason: 'failed' };
  if (!parsed.data.email_verified) return { ok: false, reason: 'unverified' };
  return {
    ok: true,
    claims: { sub: parsed.data.sub, email: parsed.data.email, name: parsed.data.name ?? '' },
  };
}
