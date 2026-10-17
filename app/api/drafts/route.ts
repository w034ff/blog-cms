import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { POST_KINDS, normalizeCategory } from '@/lib/content';
import { getOptionalSession } from '@/lib/dal';
import { canCurrentUserEdit } from '@/lib/post-access';
import { contentForKind } from '@/lib/draft-content';
import { autosavePost, createPost, postKind } from '@/lib/posts-write';
import { knownTagSlugs } from '@/lib/tags';
import { isUploadPath } from '@/lib/thumbnail';
import { generateUniqueSlug } from '@/lib/slug';

// Lenient: partial work must always persist. Strict checks happen at publish
// (app/actions/posts.ts); the date is stamped at first publish, not sent here.
const autosaveSchema = z.object({
  // Present when updating an existing post. Absent on the first save of a
  // brand-new post, which has no row (and no slug) yet.
  id: z.number().int().optional(),
  // Read only when the save creates the row; an existing row keeps the kind it was created with.
  // A missing or unknown value makes a post, the list the editor opened before scribbles existed.
  kind: z.enum(POST_KINDS).catch('post'),
  content: z.object({
    title: z.string().catch(''),
    // Off-list values (a form that lost the field, an old tab) save under the default rather than
    // failing the save — the same trade `thumbnail` below makes.
    category: z.unknown().transform(normalizeCategory),
    // Only dictionary slugs are stored (lib/tags.ts `knownTagSlugs`).
    tags: z.array(z.string()).catch([]).transform(knownTagSlugs),
    body: z.string().catch(''),
    // Normalized rather than rejected, so a bad value never fails a save; '' falls back to
    // the body's image (lib/thumbnail.ts).
    thumbnail: z
      .string()
      .transform((value) => (isUploadPath(value) ? value : ''))
      .catch(''),
  }),
});

export async function POST(req: NextRequest) {
  // A lapsed session returns 401 (no redirect) so the editor keeps the unsaved
  // draft mounted and prompts a re-login.
  const session = await getOptionalSession();
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  const parsed = autosaveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { id, kind: newKind, content: sent } = parsed.data;

  // Update intent: stash edits in the right place (live columns for a draft,
  // the private working copy for a published post). No-op if it was deleted.
  if (typeof id === 'number') {
    const kind = postKind(id);
    if (kind === null) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (!(await canCurrentUserEdit(id))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const editedAt = autosavePost(id, contentForKind(sent, kind));
    if (!editedAt) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ id, savedAt: Date.now(), editedAt });
  }

  // No row until there is something to keep, so focusing /new leaves no orphan. The slug is
  // fixed now: the URL is stable from the start and publish never touches it.
  if (sent.title.trim() === '' && sent.body.trim() === '') {
    return NextResponse.json({ skipped: true });
  }
  // Returned: the editor needs its own address to refuse a card pointing at itself
  // (docs/link-card-requirements.md §18), and this is when a new post first has one.
  const slug = generateUniqueSlug();
  const { id: newId, editedAt } = createPost({
    slug,
    ...contentForKind(sent, newKind),
    kind: newKind,
    // Unset until first publish stamps the real date; '' marks "never published".
    date: '',
    draft: true,
    authorId: session.userId,
  });
  return NextResponse.json({ id: newId, slug, savedAt: Date.now(), created: true, editedAt });
}
