import type { Metadata } from 'next';

// One place, since it is both the title suffix and og:site_name.
export const SITE_NAME = 'Tech Blog';
export const SITE_DESCRIPTION = '個人技術ブログ';

// Spread into every page's `openGraph`: a page that sets `openGraph` REPLACES the layout's object,
// so without this it would drop og:site_name and og:locale. The post page overrides `type`.
export const sharedOpenGraph = {
  siteName: SITE_NAME,
  locale: 'ja_JP',
  type: 'website',
  // One card image for the site: a per-post one would draw a Japanese title, and Satori needs a ~10MB
  // CJK font or a third-party fetch for that. Regenerate with `node scripts/make-og-image.mts`.
  images: [{ url: '/og.png', width: 1200, height: 630, alt: `${SITE_NAME} — ${SITE_DESCRIPTION}` }],
} satisfies Metadata['openGraph'];
