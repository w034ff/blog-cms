import { normalizeCategory } from '@/lib/content';
import { NextResponse, type NextRequest } from 'next/server';
import { getOptionalSession } from '@/lib/dal';
import { listAllPosts } from '@/lib/posts';
import { resolveThumbnail } from '@/lib/thumbnail';
import type { PostSearchResult } from '@/lib/types';

// The one route the link card needs (docs/link-card-requirements.md §5.3): the NodeView's slug
// lookup and the insert flow's search share one query over `posts`. A route exists because
// lib/posts.ts is `server-only`. Must stay uncached: it answers with drafts and live titles.

// A menu to pick from, not paging: a longer list means type more.
const LIMIT = 20;

export async function GET(req: NextRequest) {
  // Same gate and same shape as the autosave route: this exposes drafts — unpublished titles —
  // so it is admin-only, and 401 rather than a redirect keeps the editor mounted.
  if (!(await getOptionalSession())) {
    return new NextResponse(null, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const slug = params.get('slug');
  const query = params.get('q')?.trim() ?? '';

  // listAllPosts, not getAllPosts: drafts are offered and marked, not hidden (§5.2-4).
  const all = await listAllPosts();

  // Slug lookup: what a NodeView asks on every render.
  if (slug !== null) {
    const post = all.find((candidate) => candidate.slug === slug);
    if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(toResult(post));
  }

  // Case-insensitive title substring: the author picks from a short list of their own posts.
  const needle = query.toLowerCase();
  const matches = all
    .filter((post) => post.slug !== null)
    .filter((post) => needle === '' || post.title.toLowerCase().includes(needle))
    .slice(0, LIMIT)
    .map(toResult);
  return NextResponse.json(matches);
}

function toResult(post: {
  slug: string | null;
  title: string;
  date: string;
  draft: boolean;
  thumbnail: string;
  category: string;
  body: string;
}): PostSearchResult {
  return {
    // Non-null by the filter above for the search path, and by having been found by slug for the
    // lookup path. The column is nullable only because tightening it needs a table rebuild.
    slug: post.slug ?? '',
    title: post.title,
    date: post.date,
    draft: post.draft,
    // `resolveThumbnail` (lib/thumbnail.ts) is the one decider every surface reads; the editor asking
    // the body itself would let the two disagree.
    thumbnail: resolveThumbnail(post),
    // The id; the row turns it into a label (§5.2-5). Normalized because the
    // lookup path hands over a raw row, whose column type is plain text.
    category: normalizeCategory(post.category),
  };
}
