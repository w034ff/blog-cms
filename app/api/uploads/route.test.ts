import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetOptionalSession = vi.fn();
vi.mock('@/lib/dal', () => ({
  getOptionalSession: () => mockGetOptionalSession(),
}));

const { POST } = await import('./route');

describe('POST /api/uploads', () => {
  const loggedInSession = { userId: 1, username: 'admin' };

  beforeEach(() => {
    mockGetOptionalSession.mockReset();
  });

  describe('malformed body handling', () => {
    it('returns 400 when transmission is truncated before boundary', async () => {
      mockGetOptionalSession.mockResolvedValue(loggedInSession);
      const req = new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: '--x\r\nContent-Disposition: form-data; name="file"\r\n\r\nincomplete',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'malformed form data' });
    });

    it('returns 400 when boundary is missing in content-type header', async () => {
      mockGetOptionalSession.mockResolvedValue(loggedInSession);
      const req = new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data' },
        body: 'any-body',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'malformed form data' });
    });

    it('returns 400 when request is not multipart', async () => {
      mockGetOptionalSession.mockResolvedValue(loggedInSession);
      const req = new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'malformed form data' });
    });
  });

  it('returns 401 when not logged in even with a malformed body', async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 file is required when valid multipart lacks file field', async () => {
    mockGetOptionalSession.mockResolvedValue(loggedInSession);
    const body = '--x\r\nContent-Disposition: form-data; name="text"\r\n\r\nhello\r\n--x--\r\n';
    const req = new NextRequest('http://localhost/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'file is required' });
  });
});
