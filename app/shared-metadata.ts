import type { Metadata } from 'next';

// The site's name, in one place: it is both the browser title suffix and
// og:site_name, and those two disagreeing is the kind of thing nobody notices
// until it is on a share card.
export const SITE_NAME = 'Tech Blog';
export const SITE_DESCRIPTION = '個人技術ブログ';

// Spread into every page's `openGraph`, because a page that sets `openGraph` at
// all REPLACES the layout's object outright — it does not merge. Without this,
// giving a post its own og:title would silently drop og:site_name and og:locale
// from that page. (Next's own docs prescribe exactly this pattern.)
//
// `type` is here as the common case; the post page overrides it with 'article'.
export const sharedOpenGraph = {
  siteName: SITE_NAME,
  locale: 'ja_JP',
  type: 'website',
} satisfies Metadata['openGraph'];
