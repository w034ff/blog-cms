import { afterEach, describe, expect, it, vi } from 'vitest';

// siteOrigin is resolved once at module load (it can't change while the server runs),
// so each case needs a fresh module registry rather than a re-read of the env.
async function loadSiteOrigin(value?: string): Promise<URL> {
  vi.resetModules();
  if (value === undefined) delete process.env.SITE_ORIGIN;
  else process.env.SITE_ORIGIN = value;
  return (await import('@/lib/site')).siteOrigin;
}

afterEach(() => {
  delete process.env.SITE_ORIGIN;
});

describe('siteOrigin', () => {
  it('falls back to the dev server when SITE_ORIGIN is unset', async () => {
    expect((await loadSiteOrigin()).origin).toBe('http://localhost:3001');
  });

  it('treats an empty or blank value as unset', async () => {
    expect((await loadSiteOrigin('   ')).origin).toBe('http://localhost:3001');
  });

  it('takes the origin from a deployment host', async () => {
    expect((await loadSiteOrigin('https://blog.example.ts.net')).origin).toBe(
      'https://blog.example.ts.net',
    );
  });

  it('keeps a non-default port', async () => {
    expect((await loadSiteOrigin('http://192.168.1.10:3001')).origin).toBe(
      'http://192.168.1.10:3001',
    );
  });

  // A path would otherwise be prefixed onto every URL resolved against metadataBase.
  it('drops a path, query and fragment', async () => {
    expect((await loadSiteOrigin('https://example.com/blog?a=1#x')).origin).toBe(
      'https://example.com',
    );
  });

  // Throwing beats degrading to localhost: the symptom would otherwise be share
  // cards pointing at the reader's own machine, long after the typo.
  it('throws on a value that is not an absolute URL', async () => {
    await expect(loadSiteOrigin('example.com')).rejects.toThrow('not a valid absolute URL');
  });

  it('throws on a non-http scheme', async () => {
    await expect(loadSiteOrigin('ftp://example.com')).rejects.toThrow('must be http(s)');
  });
});
