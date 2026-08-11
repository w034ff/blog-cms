import { NextResponse, type NextRequest } from 'next/server';
import { getOptionalSession } from '@/lib/dal';
import { listAllPosts } from '@/lib/posts';
import type { PostSearchResult } from '@/lib/types';

// The one client-reachable route the link card needs (docs/link-card-requirements.md §5.3).
//
// A card stores a reference and nothing else, so the editor cannot draw one from the document
// alone — the NodeView has to look the title up every time it renders. The insert flow needs the
// same data to let the author search their own posts, so both go through here rather than through
// two routes: it is one query over `posts`, asked either by slug or by substring.
//
// `lib/posts.ts` is `server-only` and talks to drizzle directly, which is why a route exists at
// all; nothing in the editor can import it.
//
// Route Handlers are not cached by default in this version of Next, and this one must not be:
// it answers with draft posts and with titles that change as the author types elsewhere.

// Caps the answer so a query of "" doesn't return the whole blog. Not a paging design: the search
// is a menu the author picks from, and a list longer than this is a signal to type more.
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

  // listAllPosts, not getAllPosts: drafts are included on purpose (§5.2-4). An author linking to
  // a post they haven't published yet is a normal thing to do mid-writing, so the row is offered
  // and marked instead of hidden — hiding it would look like the post doesn't exist.
  const all = await listAllPosts();

  // Slug lookup: what a NodeView asks on every render.
  if (slug !== null) {
    const post = all.find((candidate) => candidate.slug === slug);
    if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(toResult(post));
  }

  // Search: case-insensitive substring over the title. Not full text and not the body — the
  // author is picking from a list of their own posts, and there are few enough that a title
  // match is the whole of what's useful (article search over the public site was deferred
  // 2026-06-29 for the same reason).
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
}): PostSearchResult {
  return {
    // Non-null by the filter above for the search path, and by having been found by slug for the
    // lookup path. The column is nullable only because tightening it needs a table rebuild.
    slug: post.slug ?? '',
    title: post.title,
    date: post.date,
    draft: post.draft,
  };
}
