import type { MetadataRoute } from 'next';
import { siteIndexable } from '@/lib/site';

// Read at request time rather than baked into the build. This file's answer comes
// from an environment variable, and the environment is exactly the thing that
// changes without a rebuild — a cached robots.txt would keep inviting or refusing
// crawlers long after SITE_INDEXABLE said otherwise.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  // Paired with the `robots: { index: false }` metadata in app/layout.tsx, which
  // is not redundant: Disallow stops a crawler fetching the page, so it never
  // reads the meta tag — and a URL discovered through a link can still be listed
  // (without content) on that basis alone. If one of these addresses ever does
  // show up in a search engine, the fix is to ALLOW crawling here so the noindex
  // is actually seen; blocking harder does the opposite of what it looks like.
  if (!siteIndexable) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return { rules: { userAgent: '*', allow: '/' } };
}
