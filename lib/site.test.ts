import { afterEach, describe, expect, it, vi } from 'vitest';

// siteOrigin is resolved once at module load (it can't change while the server runs),
// so each case needs a fresh module registry rather than a re-read of the env.
async function loadSiteOrigin(value?: string): Promise<URL> {
  vi.resetModules();
  if (value === undefined) delete process.env.SITE_ORIGIN;
  else process.env.SITE_ORIGIN = value;
  return (await import('@/lib/site')).siteOrigin;
}

async function loadSiteIndexable(value?: string): Promise<boolean> {
  vi.resetModules();
  if (value === undefined) delete process.env.SITE_INDEXABLE;
  else process.env.SITE_INDEXABLE = value;
  return (await import('@/lib/site')).siteIndexable;
}

afterEach(() => {
  delete process.env.SITE_ORIGIN;
  delete process.env.SITE_INDEXABLE;
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

// The default matters more than the flag: an environment nobody thought about —
// a LAN host, the Funnel address standing in for the real domain — has to stay
// out of the index without anyone remembering to say so.
describe('siteIndexable', () => {
  it('is off when unset', async () => {
    expect(await loadSiteIndexable()).toBe(false);
  });

  it('is on only for exactly "true"', async () => {
    expect(await loadSiteIndexable('true')).toBe(true);
    expect(await loadSiteIndexable('TRUE')).toBe(false);
    expect(await loadSiteIndexable('1')).toBe(false);
    expect(await loadSiteIndexable('yes')).toBe(false);
    expect(await loadSiteIndexable('')).toBe(false);
  });
});

describe('isOwnOrigin', () => {
  async function loadIsOwnOrigin(value?: string) {
    vi.resetModules();
    if (value === undefined) delete process.env.SITE_ORIGIN;
    else process.env.SITE_ORIGIN = value;
    return (await import('@/lib/site')).isOwnOrigin;
  }

  it('matches the Host the browser addressed, port included', async () => {
    const isOwnOrigin = await loadIsOwnOrigin('https://blog.example.com');
    expect(isOwnOrigin(new URL('http://127.0.0.1:3001/posts/a'), '127.0.0.1:3001')).toBe(true);
    expect(isOwnOrigin(new URL('http://127.0.0.1:3002/posts/a'), '127.0.0.1:3001')).toBe(false);
  });

  it('matches SITE_ORIGIN while served from another host', async () => {
    const isOwnOrigin = await loadIsOwnOrigin('https://blog.example.com');
    expect(isOwnOrigin(new URL('https://blog.example.com/posts/a'), 'localhost:3001')).toBe(true);
    expect(isOwnOrigin(new URL('http://blog.example.com/posts/a'), 'localhost:3001')).toBe(false);
  });

  it('is false for an external URL, and without a Host header', async () => {
    const isOwnOrigin = await loadIsOwnOrigin('https://blog.example.com');
    expect(isOwnOrigin(new URL('https://example.org/'), null)).toBe(false);
  });
});
