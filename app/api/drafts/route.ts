import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DEFAULT_CATEGORY } from '@/lib/content';
import { getOptionalSession } from '@/lib/dal';
import { autosavePost, createPost, postExists } from '@/lib/posts-write';
import { generateUniqueSlug } from '@/lib/slug';

// Autosave is intentionally lenient: it must persist partial, half-written work
// without ever rejecting it. Strict validation (required title, slug shape) is
// enforced only at publish time in app/actions/posts.ts. The publish date is not
// part of the content — it is stamped automatically at first publish.
const autosaveSchema = z.object({
  // Present when updating an existing post. Absent on the first save of a
  // brand-new post, which has no row (and no slug) yet.
  id: z.number().int().optional(),
  content: z.object({
    title: z.string().catch(''),
    description: z.string().catch(''),
    category: z.string().catch(''),
    tags: z.array(z.string()).catch([]),
    body: z.string().catch(''),
  }),
});

export async function POST(req: NextRequest) {
  // A lapsed session returns 401 (no redirect) so the editor keeps the unsaved
  // draft mounted and prompts a re-login.
  if (!(await getOptionalSession())) {
    return new NextResponse(null, { status: 401 });
  }

  const parsed = autosaveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { id, content } = parsed.data;

  // Update intent: stash edits in the right place (live columns for a draft,
  // the private working copy for a published post). No-op if it was deleted.
  if (typeof id === 'number') {
    if (!postExists(id)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    autosavePost(id, content);
    return NextResponse.json({ id, savedAt: Date.now() });
  }

  // Create intent: don't materialize a row until there's something worth
  // keeping, so an accidental focus on /new doesn't leave an orphan draft. The
  // opaque slug is assigned now, at row creation, so publish never has to touch
  // it and the post has a stable URL from the start.
  if (content.title.trim() === '' && content.body.trim() === '') {
    return NextResponse.json({ skipped: true });
  }
  const newId = createPost({
    slug: generateUniqueSlug(),
    ...content,
    category: content.category || DEFAULT_CATEGORY,
    // Unset until first publish stamps the real date; '' marks "never published".
    date: '',
    draft: true,
  });
  return NextResponse.json({ id: newId, savedAt: Date.now(), created: true });
}
