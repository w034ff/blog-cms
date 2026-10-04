import type { MetadataRoute } from 'next';
import { siteIndexable } from '@/lib/site';

// Answered at request time: SITE_INDEXABLE changes without a rebuild.
export const dynamic = 'force-dynamic';

// Bots that fetch a page only to draw a preview card for someone already looking at the link. None
// feeds a search index, so letting them in keeps the address out of search results while a shared
// link still gets a card. Slackbot ignores robots.txt anyway; every other name here obeys it and
// draws no card without an entry. A whitelist: add names as they come up.
const PREVIEW_BOTS = [
  'Twitterbot',
  'facebookexternalhit',
  'Facebot',
  'Discordbot',
  'TelegramBot',
  'LinkedInBot',
  'WhatsApp',
  'Slackbot',
  'Slackbot-LinkExpanding',
];

export default function robots(): MetadataRoute.Robots {
  if (siteIndexable) {
    return { rules: { userAgent: '*', allow: '/' } };
  }
  // Not redundant with the `robots: { index: false }` metadata in app/layout.tsx: a disallowed
  // crawler never reads the meta tag, yet can still list a URL it found through a link. If an
  // address does show up in search, ALLOW crawling here so the noindex is seen.
  return {
    rules: [
      { userAgent: PREVIEW_BOTS, allow: '/' },
      { userAgent: '*', disallow: '/' },
    ],
  };
}
