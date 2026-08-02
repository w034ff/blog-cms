import type { MetadataRoute } from 'next';
import { siteIndexable } from '@/lib/site';

// Read at request time rather than baked into the build. This file's answer comes
// from an environment variable, and the environment is exactly the thing that
// changes without a rebuild — a cached robots.txt would keep inviting or refusing
// crawlers long after SITE_INDEXABLE said otherwise.
export const dynamic = 'force-dynamic';

// The bots that fetch a page only to draw a preview card for a person who is
// already looking at the link. Allowing them costs nothing this file is trying to
// protect: none of them feed a search index, so "keep the provisional address out
// of search results" and "let a shared link look like something" turn out to be
// separate wishes that a single Disallow was conflating.
//
// Slackbot is here for the record rather than for effect — Slack documents that it
// does not consult robots.txt at all, on the grounds that it fetches on behalf of
// a person rather than crawling. Every other name on this list does consult it,
// and stays silent without an entry: the same thing bit crates.io, whose Discord
// embeds went blank for exactly this reason.
//
// A whitelist, so anything not named simply gets no card. Add names as they come
// up rather than guessing at tokens.
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
  // Paired with the `robots: { index: false }` metadata in app/layout.tsx, which
  // is not redundant: Disallow stops a crawler fetching the page, so it never
  // reads the meta tag — and a URL discovered through a link can still be listed
  // (without content) on that basis alone. If one of these addresses ever does
  // show up in a search engine, the fix is to ALLOW crawling here so the noindex
  // is actually seen; blocking harder does the opposite of what it looks like.
  return {
    rules: [
      { userAgent: PREVIEW_BOTS, allow: '/' },
      { userAgent: '*', disallow: '/' },
    ],
  };
}
