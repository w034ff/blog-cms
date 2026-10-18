import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeAuthRequest } from '@/lib/google-oidc';

const session = vi.hoisted(() => ({ current: null as { userId: number } | null }));
vi.mock('@/lib/dal', () => ({ getOptionalSession: async () => session.current }));

const { GET } = await import('./route');

beforeEach(() => {
  session.current = null;
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-123');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /auth/google (docs/multi-author-requirements.md §9.3)', () => {
  it('is a 404 without an OAuth client (criterion 19)', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    expect((await GET()).status).toBe(404);
  });

  it('sends the browser to Google and keeps the request in a path-scoped cookie', async () => {
    const response = await GET();
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe('https://accounts.google.com');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^google_auth=/);
    expect(cookie).toMatch(/Path=\/auth\/google/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    const saved = decodeAuthRequest(cookie.split(';')[0].slice('google_auth='.length));
    expect(saved?.state).toBe(location.searchParams.get('state'));
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/auth/google/callback',
    );
  });

  it('sends someone already signed in to the admin screens', async () => {
    session.current = { userId: 1 };
    const response = await GET();
    expect(response.headers.get('location')).toBe('http://localhost:3001/admin');
  });
});
