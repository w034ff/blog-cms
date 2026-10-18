import { createHash } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  authorizationUrl,
  decodeAuthRequest,
  encodeAuthRequest,
  exchangeCode,
  newAuthRequest,
  verifyIdToken,
  type GoogleClient,
} from './google-oidc';

const client: GoogleClient = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:3001/auth/google/callback',
};
const NONCE = 'nonce-abc';

type Keys = Awaited<ReturnType<typeof generateKeyPair>>;
let google: Keys;
let impostor: Keys;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  google = await generateKeyPair('RS256');
  impostor = await generateKeyPair('RS256');
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(google.publicKey)), kid: 'k1', alg: 'RS256' }],
  });
});

const goodClaims: JWTPayload = {
  sub: '1234567890',
  email: 'hanako.sato@example.com',
  email_verified: true,
  name: '佐藤 花子',
  nonce: NONCE,
};

async function token(
  overrides: JWTPayload = {},
  options: { key?: Keys; iss?: string; aud?: string; exp?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...goodClaims, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(options.iss ?? 'https://accounts.google.com')
    .setAudience(options.aud ?? client.clientId)
    .setIssuedAt(now)
    .setExpirationTime(options.exp ?? now + 3600)
    .sign((options.key ?? google).privateKey);
}

const expected = { clientId: client.clientId, nonce: NONCE };

describe('verifyIdToken (docs/multi-author-requirements.md §9.3, criterion 13)', () => {
  it('accepts a token Google signed for this client and nonce', async () => {
    expect(await verifyIdToken(await token(), expected, keys)).toEqual({
      ok: true,
      claims: { sub: '1234567890', email: 'hanako.sato@example.com', name: '佐藤 花子' },
    });
  });

  it('accepts the issuer written without a scheme', async () => {
    const result = await verifyIdToken(
      await token({}, { iss: 'accounts.google.com' }),
      expected,
      keys,
    );
    expect(result.ok).toBe(true);
  });

  it('reads a missing name as empty', async () => {
    const result = await verifyIdToken(await token({ name: undefined }), expected, keys);
    expect(result.ok && result.claims.name).toBe('');
  });

  it.each([
    ['another key', () => token({}, { key: impostor })],
    ['another issuer', () => token({}, { iss: 'https://evil.example.com' })],
    ['another audience', () => token({}, { aud: 'someone-else' })],
    ['an expired token', () => token({}, { exp: Math.floor(Date.now() / 1000) - 600 })],
    ['another nonce', () => token({ nonce: 'replayed' })],
    ['no sub', () => token({ sub: undefined })],
  ])('refuses %s as failed', async (_label, make) => {
    expect(await verifyIdToken(await make(), expected, keys)).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('refuses an address Google has not verified', async () => {
    expect(await verifyIdToken(await token({ email_verified: false }), expected, keys)).toEqual({
      ok: false,
      reason: 'unverified',
    });
  });
});

describe('the authorization request', () => {
  it('sends an S256 challenge of the verifier it keeps', () => {
    const request = newAuthRequest();
    const url = authorizationUrl(client, request);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: request.state,
      nonce: request.nonce,
      code_challenge: createHash('sha256').update(request.codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
  });

  it('round-trips through the cookie and rejects anything else', () => {
    const request = newAuthRequest();
    expect(decodeAuthRequest(encodeAuthRequest(request))).toEqual(request);
    expect(decodeAuthRequest(undefined)).toBeNull();
    expect(decodeAuthRequest('not-json')).toBeNull();
    expect(decodeAuthRequest(Buffer.from('{"state":"x"}').toString('base64url'))).toBeNull();
  });
});

describe('exchangeCode', () => {
  it('posts the code with the verifier and returns the ID token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id_token: 'the-token' }));
    expect(await exchangeCode(client, 'the-code', 'the-verifier', fetchImpl)).toBe('the-token');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toMatchObject({
      code: 'the-code',
      code_verifier: 'the-verifier',
      grant_type: 'authorization_code',
      redirect_uri: client.redirectUri,
    });
  });

  it('throws when Google refuses the code', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    await expect(exchangeCode(client, 'used', 'v', fetchImpl)).rejects.toThrow();
  });
});
