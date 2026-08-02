import { afterEach, describe, expect, it, vi } from 'vitest';

// robots() reads siteIndexable, which lib/site.ts resolves once at module load —
// so each case needs a fresh registry rather than a re-read of the environment.
async function loadRobots(indexable: boolean) {
  vi.resetModules();
  if (indexable) process.env.SITE_INDEXABLE = 'true';
  else delete process.env.SITE_INDEXABLE;
  return (await import('@/app/robots')).default();
}

afterEach(() => {
  delete process.env.SITE_INDEXABLE;
});

describe('robots.txt', () => {
  it('opens the site up once it is the published address', async () => {
    expect(await loadRobots(true)).toEqual({ rules: { userAgent: '*', allow: '/' } });
  });

  // The pairing that matters: search engines refused, link-preview bots let
  // through. A single `Disallow: /` conflates the two, and the visible symptom is
  // a shared link rendering as a bare URL.
  it('refuses crawlers in general but admits the preview bots', async () => {
    const { rules } = await loadRobots(false);
    expect(Array.isArray(rules)).toBe(true);
    const list = Array.isArray(rules) ? rules : [rules];

    const catchAll = list.find((rule) => rule.userAgent === '*');
    expect(catchAll).toEqual({ userAgent: '*', disallow: '/' });

    const preview = list.find((rule) => Array.isArray(rule.userAgent));
    expect(preview?.allow).toBe('/');
    expect(preview?.userAgent).toEqual(
      expect.arrayContaining(['Twitterbot', 'facebookexternalhit', 'Discordbot']),
    );
    // Nothing in the allowed list may be a search crawler — that is the one way
    // this file could quietly stop doing its job.
    for (const agent of preview?.userAgent ?? []) {
      expect(agent).not.toMatch(/googlebot|bingbot|applebot|yandex|baiduspider/i);
    }
  });
});
