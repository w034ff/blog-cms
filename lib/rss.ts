import 'server-only';
import { siteOrigin } from '@/lib/site';
import type { SiteIdentity } from '@/app/shared-metadata';
import { excerptFromBody } from '@/lib/excerpt';
import type { Post } from '@/lib/types';

// How many items ship when the caller doesn't ask for `?all=1` — matches Zenn's
// own documented default (docs/cms-features.md §7/§9).
const DEFAULT_ITEM_LIMIT = 20;

// A literal `]]>` inside the wrapped value would terminate the CDATA section early and corrupt
// the XML; closing and reopening around it is the standard escape (docs/cms-features.md §4).
export function wrapCdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

type FeedPost = Post & { slug: string };

// `slug` is typed nullable and `date` carries a '' sentinel for a never-published row
// (lib/types.ts) — `getAllPosts()` should never actually return either case, but the type
// doesn't promise it, and templating either straight into the XML fails silently: a null
// slug renders the literal string "/posts/null" into `<link>`/`<guid>`, and `new
// Date('')` renders as the string "Invalid Date" in `<pubDate>` (docs/cms-features.md §4).
function isFeedEligible(post: Post): post is FeedPost {
  return post.slug !== null && post.date !== '';
}

function buildItem(post: FeedPost): string {
  const link = `${siteOrigin.origin}/posts/${post.slug}`;
  return (
    '<item>' +
    `<title>${wrapCdata(post.title)}</title>` +
    `<link>${link}</link>` +
    `<guid isPermaLink="true">${link}</guid>` +
    `<pubDate>${new Date(post.date).toUTCString()}</pubDate>` +
    `<description>${wrapCdata(excerptFromBody(post.body))}</description>` +
    '</item>'
  );
}

// `limit`: number of items to include, or `null` for every eligible post (`?all=1`).
// Omitted entirely, it defaults to `DEFAULT_ITEM_LIMIT`.
export function buildRssFeed(
  site: SiteIdentity,
  posts: Post[],
  options: { limit?: number | null } = {},
): string {
  const limit = options.limit === undefined ? DEFAULT_ITEM_LIMIT : options.limit;
  const eligible = posts.filter(isFeedEligible);
  const items = limit === null ? eligible : eligible.slice(0, limit);

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0">' +
    '<channel>' +
    `<title>${wrapCdata(site.name)}</title>` +
    `<link>${siteOrigin.origin}</link>` +
    `<description>${wrapCdata(site.description)}</description>` +
    '<language>ja</language>' +
    // Request-time "now", not derived from the items — docs/cms-features.md §9: no
    // reader actually consults this field, and this feed has no per-item update
    // signal to make a content-derived value meaningful.
    `<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>` +
    items.map(buildItem).join('') +
    '</channel>' +
    '</rss>'
  );
}
