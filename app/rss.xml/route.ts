import { getAllPosts } from '@/lib/posts';
import { buildRssFeed } from '@/lib/rss';

// A plain Route Handler: no file convention covers RSS (docs/cms-features.md §2). `force-dynamic`
// only marks consistency with the public pages; route handlers are uncached anyway (§7).
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
