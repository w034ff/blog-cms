import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAuthRequest, type AuthRequest } from '@/lib/google-oidc';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  signInWithGoogle: vi.fn(),
  exchangeCode: vi.fn(),
  verifyIdToken: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ createSession: mocks.createSession, cookieSecure: false }));
vi.mock('@/lib/google-login', () => ({ signInWithGoogle: mocks.signInWithGoogle }));
vi.mock('@/lib/google-oidc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/google-oidc')>()),
  exchangeCode: mocks.exchangeCode,
  verifyIdToken: mocks.verifyIdToken,
}));

const { GET } = await import('./route');

const saved: AuthRequest = { state: 'state-1', nonce: 'nonce-1', codeVerifier: 'verifier-1' };
const claims = { sub: 's', email: 'a@example.com', name: 'A' };

function callback(query: string, cookie: string | null = encodeAuthRequest(saved)): NextRequest {
  return new NextRequest(`http://localhost:3001/auth/google/callback?${query}`, {
    headers: cookie === null ? {} : { cookie: `google_auth=${cookie}` },
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.exchangeCode.mockResolvedValue('id-token');
  mocks.verifyIdToken.mockResolvedValue({ ok: true, claims });
  mocks.signInWithGoogle.mockReturnValue({ ok: true, userId: 5 });
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-123');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
});
afterEach(() => vi.unstubAllEnvs());

function expectRefused(response: Response, reason: string): void {
  expect(response.headers.get('location')).toBe(`http://localhost:3001/login?error=${reason}`);
  expect(mocks.createSession).not.toHaveBeenCalled();
}

function expectCookieCleared(response: Response): void {
  expect(response.headers.get('set-cookie')).toMatch(/^google_auth=;.*Path=\/auth\/google/);
}

describe('GET /auth/google/callback (docs/multi-author-requirements.md §9.3)', () => {
  it('signs in and goes to the admin screens', async () => {
    const response = await GET(callback('state=state-1&code=c'));
    expect(response.headers.get('location')).toBe('http://localhost:3001/admin');
    expect(mocks.exchangeCode).toHaveBeenCalledWith(expect.anything(), 'c', 'verifier-1');
    expect(mocks.verifyIdToken).toHaveBeenCalledWith('id-token', {
      clientId: 'client-123',
      nonce: 'nonce-1',
    });
    expect(mocks.createSession).toHaveBeenCalledWith({ userId: 5 });
    expectCookieCleared(response);
  });

  it.each([
    ['a state from another request', callback('state=other&code=c')],
    ['no cookie', callback('state=state-1&code=c', null)],
    ['a cancelled consent', callback('state=state-1&error=access_denied')],
  ])('refuses %s as failed and clears the cookie (criterion 14)', async (_label, request) => {
    const response = await GET(request);
    expectRefused(response, 'failed');
    expectCookieCleared(response);
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it('refuses when the code exchange fails', async () => {
    mocks.exchangeCode.mockRejectedValue(new Error('invalid_grant'));
    expectRefused(await GET(callback('state=state-1&code=c')), 'failed');
  });

  it('passes on the token check and the sign-in decision', async () => {
    mocks.verifyIdToken.mockResolvedValue({ ok: false, reason: 'unverified' });
    expectRefused(await GET(callback('state=state-1&code=c')), 'unverified');
    mocks.verifyIdToken.mockResolvedValue({ ok: true, claims });
    mocks.signInWithGoogle.mockReturnValue({ ok: false, reason: 'not_invited' });
    expectRefused(await GET(callback('state=state-1&code=c')), 'not_invited');
  });

  it('is a 404 without an OAuth client', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect((await GET(callback('state=state-1&code=c'))).status).toBe(404);
  });
});
