import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { normalizeCategory } from '@/lib/content';
import { getOptionalSession } from '@/lib/dal';
import { autosavePost, createPost, postExists } from '@/lib/posts-write';
import { isUploadPath } from '@/lib/thumbnail';
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
    // Off-list values (a form that lost the field, an old tab) save under the default rather than
    // failing the save — the same trade `thumbnail` below makes.
    category: z.unknown().transform(normalizeCategory),
    tags: z.array(z.string()).catch([]),
    body: z.string().catch(''),
    // Normalized rather than rejected, so a bad value can never be the reason a
    // draft fails to save. '' is the column's "author chose none" state and the
    // reader-facing image falls back to the body (lib/thumbnail.ts), so dropping
    // an unusable path costs nothing an author would notice.
    thumbnail: z
      .string()
      .transform((value) => (isUploadPath(value) ? value : ''))
      .catch(''),
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
  // Reported back below, not just written: the editor has to know its own address to refuse a
  // link card pointing at it (docs/link-card-requirements.md §18), and this is the only moment a
  // brand-new post learns one — publish is too late, and the row is already searchable from here.
  const slug = generateUniqueSlug();
  const newId = createPost({
    slug,
    ...content,
    // Unset until first publish stamps the real date; '' marks "never published".
    date: '',
    draft: true,
  });
  return NextResponse.json({ id: newId, slug, savedAt: Date.now(), created: true });
}
