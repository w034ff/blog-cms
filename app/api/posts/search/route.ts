import { normalizeCategory } from '@/lib/content';
import { NextResponse, type NextRequest } from 'next/server';
import { getOptionalSession } from '@/lib/dal';
import { getHiddenAuthorIds, listAllPosts } from '@/lib/posts';
import { resolveThumbnail } from '@/lib/thumbnail';
import { OWN_POSTS_SCOPE, type PostSearchResult } from '@/lib/types';

// The one route the link card needs (docs/link-card-requirements.md §5.3): the NodeView's slug
// lookup and the insert flow's search share one query over `posts`. A route exists because
// lib/posts.ts is `server-only`. Must stay uncached: it answers with drafts and live titles.

// A menu to pick from, not paging: a longer list means type more.
const LIMIT = 20;

export async function GET(req: NextRequest) {
  // Gate matching the autosave route: any signed-in author or admin may access this, returning
  // published posts (excluding suspended and withdrawing authors) and only their own drafts. 401 keeps the editor mounted.
  const session = await getOptionalSession();
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const slug = params.get('slug');
  const query = params.get('q')?.trim() ?? '';
  // Filtered here rather than in the dialog, so `LIMIT` counts only the author's own posts.
  const ownOnly = params.get('scope') === OWN_POSTS_SCOPE;

  // listAllPosts, not getAllPosts: drafts are offered and marked, not hidden (§5.2-4).
  // Return published posts (excluding suspended and withdrawing authors) and only the signed-in user's drafts
  // (docs/multi-author-requirements.md §4.2, §5).
  const all = await listAllPosts();
  const hidden = getHiddenAuthorIds();
  const visible = all.filter((post) => {
    if (post.draft) {
      return post.authorId === session.userId;
    }
    return post.authorId === null || !hidden.has(post.authorId);
  });

  // Slug lookup: what a NodeView asks on every render.
  if (slug !== null) {
    const post = visible.find((candidate) => candidate.slug === slug);
    if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(toResult(post));
  }

  // Case-insensitive title substring: the author picks from a short list of their own posts.
  const needle = query.toLowerCase();
  const matches = visible
    .filter((post) => post.slug !== null)
    .filter((post) => !ownOnly || post.authorId === session.userId)
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
