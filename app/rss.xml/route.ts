import { getAllPosts } from '@/lib/posts';
import { buildRssFeed } from '@/lib/rss';

// No special file convention covers RSS in this Next.js version (only sitemap.xml,
// robots.txt, and a few others do) — a plain Route Handler is the documented way
// (docs/cms-features.md §2). Not cached by Next.js by default regardless of this
// declaration (same doc, §7); `force-dynamic` here is a consistency marker with the
// rest of the site's public pages, not what causes the per-request DB read.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const all = searchParams.get('all') === '1';
  const posts = await getAllPosts();
  const xml = buildRssFeed(posts, { limit: all ? null : undefined });

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
