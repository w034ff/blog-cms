import 'server-only';
import { asc, eq, or } from 'drizzle-orm';
import { TAG_NAME_MAX_LENGTH, normalizeTagName, tagSlug } from '@/lib/content';
import { db } from '@/lib/db';
import { postRevisions, posts, tags } from '@/lib/db/schema';
import type { DraftContent, Tag } from '@/lib/types';

// The tag dictionary (docs/editor-requirements.md §12.33). Posts refer to tags by slug; this module
// is where a slug becomes a name, where a new tag is admitted, and where a tag is renamed or
// removed.

export function listTags(): Tag[] {
  return db.select({ slug: tags.slug, name: tags.name }).from(tags).orderBy(asc(tags.name)).all();
}

export function tagNames(): Map<string, string> {
  return new Map(listTags().map((tag) => [tag.slug, tag.name]));
}

// `slugs` as the entries a surface draws, dropping any the dictionary does not have. `names` is
// `tagNames()`, passed in by a caller resolving many posts from one read.
export function resolveTags(
  slugs: readonly string[],
  names: ReadonlyMap<string, string> = tagNames(),
): Tag[] {
  return slugs.flatMap((slug) => {
    const name = names.get(slug);
    return name === undefined ? [] : [{ slug, name }];
  });
}

// The slugs of `slugs` that are in the dictionary, first occurrence kept, order kept. What the
// write paths store: a slug the dictionary does not have reached them from a tab that outlived a
// deletion, or from a crafted request, and is dropped rather than refused — the same trade the
// thumbnail makes — so it can never be why a save fails.
export function knownTagSlugs(slugs: readonly string[]): string[] {
  const names = tagNames();
  return [...new Set(slugs)].filter((slug) => names.has(slug));
}

export type TagResult = { ok: true; tag: Tag; created: boolean } | { ok: false; error: string };

function checkName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeTagName(raw);
  if (name === '') return { ok: false, error: 'タグ名を入力してください。' };
  if (name.length > TAG_NAME_MAX_LENGTH) {
    return { ok: false, error: `タグ名は ${TAG_NAME_MAX_LENGTH} 文字までです。` };
  }
  return { ok: true, name };
}

// Admit a tag, or hand back the one that is already there. Idempotent by slug, so `Next.js` typed
// where `next.js` exists returns that tag rather than a second one — which is the whole reason for
// the dictionary — and by name, for a name whose slug differs only in characters `tagSlug` strips.
export function createTag(raw: string): TagResult {
  const checked = checkName(raw);
  if (!checked.ok) return checked;
  const slug = tagSlug(checked.name);
  if (slug === '') return { ok: false, error: 'このタグ名からは URL を作れません。' };

  const existing = db
    .select({ slug: tags.slug, name: tags.name })
    .from(tags)
    .where(eq(tags.slug, slug))
    .get();
  if (existing) return { ok: true, tag: existing, created: false };
  const sameName = db
    .select({ slug: tags.slug, name: tags.name })
    .from(tags)
    .where(eq(tags.name, checked.name))
    .get();
  if (sameName) return { ok: true, tag: sameName, created: false };

  db.insert(tags).values({ slug, name: checked.name }).run();
  return { ok: true, tag: { slug, name: checked.name }, created: true };
}

// Change what a tag is called. The slug stays: it is the tag's URL, and posts hold it.
export function renameTag(slug: string, raw: string): TagResult {
  const checked = checkName(raw);
  if (!checked.ok) return checked;
  const current = db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).get();
  if (!current) return { ok: false, error: 'タグが見つかりません。' };
  // By slug as well as by name: `REACT` next to an existing `react` would be two tags a reader
  // cannot tell apart, and the editor would resolve the typed name to the other one.
  const clash = db
    .select({ slug: tags.slug })
    .from(tags)
    .where(or(eq(tags.name, checked.name), eq(tags.slug, tagSlug(checked.name))))
    .all()
    .find((tag) => tag.slug !== slug);
  if (clash) {
    return { ok: false, error: `「${checked.name}」という名前のタグは既にあります。` };
  }
  db.update(tags).set({ name: checked.name }).where(eq(tags.id, current.id)).run();
  return { ok: true, tag: { slug, name: checked.name }, created: false };
}

function without(list: unknown, slug: string): string[] | null {
  if (!Array.isArray(list) || !list.includes(slug)) return null;
  return list.filter((tag): tag is string => typeof tag === 'string' && tag !== slug);
}

// Remove a tag from the dictionary and from every place a post holds it: the live column, the
// working copy and the revisions. All three, or a restore would bring the slug back, and a working
// copy left carrying it would differ from the live column and raise a false 未公開の変更あり. No
// `updatedAt`, no revision: the author did not edit these posts.
export function deleteTag(slug: string): boolean {
  return db.transaction((tx) => {
    const found = tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).get();
    if (!found) return false;

    for (const row of tx
      .select({ id: posts.id, tags: posts.tags, draftContent: posts.draftContent })
      .from(posts)
      .all()) {
      const live = without(row.tags, slug);
      const copy = row.draftContent ? without(row.draftContent.tags, slug) : null;
      if (live === null && copy === null) continue;
      tx.update(posts)
        .set({
          ...(live === null ? {} : { tags: live }),
          ...(copy === null || !row.draftContent
            ? {}
            : { draftContent: { ...row.draftContent, tags: copy } }),
        })
        .where(eq(posts.id, row.id))
        .run();
    }

    for (const row of tx
      .select({ id: postRevisions.id, content: postRevisions.content })
      .from(postRevisions)
      .all()) {
      const kept = without(row.content.tags, slug);
      if (kept === null) continue;
      const content: DraftContent = { ...row.content, tags: kept };
      tx.update(postRevisions).set({ content }).where(eq(postRevisions.id, row.id)).run();
    }

    tx.delete(tags).where(eq(tags.id, found.id)).run();
    return true;
  });
}

// How many posts carry each tag, drafts and pending edits included — what /admin/tags shows so a
// delete is not a guess. A post counts once even when both its live column and its working copy
// hold the tag.
export function tagUsage(): Map<string, number> {
  const usage = new Map<string, number>();
  for (const row of db
    .select({ tags: posts.tags, draftContent: posts.draftContent })
    .from(posts)
    .all()) {
    const held = new Set<string>([
      ...(Array.isArray(row.tags) ? row.tags : []),
      ...(row.draftContent && Array.isArray(row.draftContent.tags) ? row.draftContent.tags : []),
    ]);
    for (const slug of held) usage.set(slug, (usage.get(slug) ?? 0) + 1);
  }
  return usage;
}
