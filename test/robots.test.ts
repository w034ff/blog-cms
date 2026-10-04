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

  // Search engines refused, preview bots admitted: a lone `Disallow: /` renders shared links bare.
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
    // No allowed agent may be a search crawler: the one way this could quietly stop working.
    for (const agent of preview?.userAgent ?? []) {
      expect(agent).not.toMatch(/googlebot|bingbot|applebot|yandex|baiduspider/i);
    }
  });
});
