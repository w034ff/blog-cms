import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { TAG_NAME_MAX_LENGTH, normalizeTagName, tagSlug, tagSlugProblem } from '@/lib/content';
import { db } from '@/lib/db';
import { postRevisions, posts, tagAliases, tags } from '@/lib/db/schema';
import type { DictionaryTag, DraftContent, Tag } from '@/lib/types';

// The tag dictionary (docs/editor-requirements.md §12.33). Posts refer to tags by slug; this module
// is where a slug becomes a name, where an alias becomes the slug it stands for, where a new tag is
// admitted, and where a tag is renamed, moved, merged or removed.

// In identifier order: the identifier is what an author types and what the lists lead with, and a
// display name's capitals would otherwise sort ahead of every lowercase one.
export function listTags(): Tag[] {
  return db.select({ slug: tags.slug, name: tags.name }).from(tags).orderBy(asc(tags.slug)).all();
}

export function tagNames(): Map<string, string> {
  return new Map(listTags().map((tag) => [tag.slug, tag.name]));
}

// Every alias, to the identifier of the tag it stands for.
export function aliasTargets(): Map<string, string> {
  return new Map(
    db
      .select({ alias: tagAliases.alias, slug: tags.slug })
      .from(tagAliases)
      .innerJoin(tags, eq(tagAliases.tagId, tags.id))
      .all()
      .map((row) => [row.alias, row.slug]),
  );
}

// The tags with their aliases, for the editor's field and /admin/tags.
export function listDictionary(): DictionaryTag[] {
  const byTag = new Map<string, string[]>();
  for (const [alias, slug] of [...aliasTargets()].sort(([a], [b]) => a.localeCompare(b))) {
    byTag.set(slug, [...(byTag.get(slug) ?? []), alias]);
  }
  return listTags().map((tag) => ({ ...tag, aliases: byTag.get(tag.slug) ?? [] }));
}

// The identifier a word stands for: itself when it is a tag's, the tag's when it is an alias, null
// when it is neither.
export function resolveTagSlug(word: string): string | null {
  if (tagNames().has(word)) return word;
  return aliasTargets().get(word) ?? null;
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

// `slugs` as the write paths store them: each alias replaced by its tag's identifier (a post never
// holds an alias), then each identifier once, order kept. A word that is neither reached them from
// a tab that outlived a deletion, or from a crafted request, and is dropped rather than refused —
// the same trade the thumbnail makes — so it can never be why a save fails.
export function knownTagSlugs(slugs: readonly string[]): string[] {
  const names = tagNames();
  const aliases = aliasTargets();
  const resolved = slugs.flatMap((slug) => {
    if (names.has(slug)) return [slug];
    const target = aliases.get(slug);
    return target === undefined ? [] : [target];
  });
  return [...new Set(resolved)];
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

// Admit a tag, or hand back the one that is already there. What is typed has no symbols or spaces
// (`hasTagSymbols`), and is idempotent by slug, so `NextJS` typed where `nextjs` exists returns that
// tag rather than a second one — which is the whole reason for the dictionary — and by name, for a
// tag whose display name was changed to exactly what was typed.
export function createTag(raw: string): TagResult {
  const checked = checkName(raw);
  if (!checked.ok) return checked;
  const problem = tagSlugProblem(checked.name);
  if (problem !== null) return { ok: false, error: problem };
  const slug = tagSlug(checked.name);

  // An alias is the tag it stands for, so typing `next` where it is `nextjs`'s gets `nextjs`.
  const resolved = resolveTagSlug(slug) ?? slug;
  const existing = db
    .select({ slug: tags.slug, name: tags.name })
    .from(tags)
    .where(eq(tags.slug, resolved))
    .get();
  if (existing) return { ok: true, tag: existing, created: false };
  const sameName = db
    .select({ slug: tags.slug, name: tags.name })
    .from(tags)
    .where(eq(tags.name, checked.name))
    .get();
  if (sameName) return { ok: true, tag: sameName, created: false };

  // Named after its identifier, as Zenn's topics are when an author makes one: what was typed may
  // carry capitals, and a display name that differs from the identifier is /admin/tags' to give.
  db.insert(tags).values({ slug, name: slug }).run();
  return { ok: true, tag: { slug, name: slug }, created: true };
}

// Change what a tag is called. The slug stays: it is the tag's URL, and posts hold it. The name is
// for display only, so it may carry what a slug may not — `nextjs` shown as `Next.js`.
export function renameTag(slug: string, raw: string): TagResult {
  const checked = checkName(raw);
  if (!checked.ok) return checked;
  const current = db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).get();
  if (!current) return { ok: false, error: 'タグが見つかりません。' };
  // Compared NFKC-folded and lowercased against other tags' identifiers, names and aliases, so
  // `REACT` can't sit beside `react`. Symbols are kept: stripping them made `C#` and `C++` equal to
  // `c`. So `Re.act` is allowed beside `react`, which nobody sets on purpose.
  const key = normalizeTagName(checked.name).toLowerCase();
  const fold = (text: string) => normalizeTagName(text).toLowerCase();
  const clash =
    listTags().some((tag) => tag.slug !== slug && (tag.slug === key || fold(tag.name) === key)) ||
    [...aliasTargets()].some(([alias, owner]) => owner !== slug && alias === key);
  if (clash) {
    return { ok: false, error: `「${checked.name}」という名前のタグは既にあります。` };
  }
  db.update(tags).set({ name: checked.name }).where(eq(tags.id, current.id)).run();
  return { ok: true, tag: { slug, name: checked.name }, created: false };
}

// `list` with `from` replaced by `to` (or removed, for null), each slug once, order kept — or null
// when `list` does not hold `from`, so the caller can leave the row alone.
function replaced(list: unknown, from: string, to: string | null): string[] | null {
  if (!Array.isArray(list) || !list.includes(from)) return null;
  const next = list
    .filter((tag): tag is string => typeof tag === 'string')
    .flatMap((tag) => (tag === from ? (to === null ? [] : [to]) : [tag]));
  return [...new Set(next)];
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Replace a slug in every place a post holds it: the live column, the working copy and the
// revisions. All three, or a restore would bring the old slug back, and a working copy left
// carrying it would differ from the live column and raise a false 未公開の変更あり. No `updatedAt`, no
// `editedAt`, no revision: the author did not edit these posts.
function replaceTagInPosts(tx: Transaction, from: string, to: string | null): void {
  for (const row of tx
    .select({ id: posts.id, tags: posts.tags, draftContent: posts.draftContent })
    .from(posts)
    .all()) {
    const live = replaced(row.tags, from, to);
    const copy = row.draftContent ? replaced(row.draftContent.tags, from, to) : null;
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
    const kept = replaced(row.content.tags, from, to);
    if (kept === null) continue;
    const content: DraftContent = { ...row.content, tags: kept };
    tx.update(postRevisions).set({ content }).where(eq(postRevisions.id, row.id)).run();
  }
}

// Remove a tag from the dictionary and from every post that holds it.
export function deleteTag(slug: string): boolean {
  return db.transaction((tx) => {
    const found = tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).get();
    if (!found) return false;
    replaceTagInPosts(tx, slug, null);
    tx.delete(tagAliases).where(eq(tagAliases.tagId, found.id)).run();
    tx.delete(tags).where(eq(tags.id, found.id)).run();
    return true;
  });
}

export type SlugChangeResult =
  { ok: true; slug: string; merged: boolean } | { ok: false; error: string };

// Give a tag another identifier, under the same rules as a new one (`tagSlugProblem`). Every post
// holding the old identifier is rewritten to the new one, and the old identifier stays behind as an
// alias of the tag — so /tags/<old> redirects, and the old word typed in the editor finds the tag
// instead of offering to make it again. A display name never changed from the old identifier
// follows it; one that was, stays.
//
// When the new identifier names another tag — as its identifier or as one of its aliases — this is
// a merge: the posts move onto that tag (a post holding both keeps one), this tag's identifier and
// aliases become that tag's aliases, and this tag goes. When it names one of this tag's own
// aliases, the two swap: the alias becomes the identifier, the identifier an alias.
export function changeTagSlug(from: string, raw: string): SlugChangeResult {
  const problem = tagSlugProblem(raw);
  if (problem !== null) return { ok: false, error: problem };
  const to = tagSlug(raw);
  if (to === '') return { ok: false, error: 'タグ名を入力してください。' };
  if (to === from) return { ok: false, error: '識別子が同じです。' };

  return db.transaction((tx): SlugChangeResult => {
    const source = tx.select().from(tags).where(eq(tags.slug, from)).get();
    if (!source) return { ok: false, error: 'タグが見つかりません。' };
    const alias = tx.select().from(tagAliases).where(eq(tagAliases.alias, to)).get();
    const target = alias
      ? tx.select().from(tags).where(eq(tags.id, alias.tagId)).get()
      : tx.select().from(tags).where(eq(tags.slug, to)).get();

    if (target && target.id !== source.id) {
      replaceTagInPosts(tx, from, target.slug);
      tx.update(tagAliases).set({ tagId: target.id }).where(eq(tagAliases.tagId, source.id)).run();
      tx.insert(tagAliases).values({ alias: from, tagId: target.id }).run();
      tx.delete(tags).where(eq(tags.id, source.id)).run();
      return { ok: true, slug: target.slug, merged: true };
    }
    // A display name never changed from the old identifier follows it — unless another tag already
    // shows that name, which is refused before anything is rewritten.
    const name = source.name === from ? to : source.name;
    const nameTaken = tx
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.name, name))
      .all()
      .some((row) => row.id !== source.id);
    if (nameTaken) return { ok: false, error: `「${name}」という名前のタグは既にあります。` };
    if (alias) tx.delete(tagAliases).where(eq(tagAliases.alias, to)).run();
    replaceTagInPosts(tx, from, to);
    tx.update(tags).set({ slug: to, name }).where(eq(tags.id, source.id)).run();
    tx.insert(tagAliases).values({ alias: from, tagId: source.id }).run();
    return { ok: true, slug: to, merged: false };
  });
}

export type UpdateResult = { ok: true; slug: string } | { ok: false; error: string };

// /admin/tags' one 保存 for a tag: a display name and an identifier, either or both changed. The
// identifier is checked first, so a refused one changes nothing. A merge (the identifier names a
// tag that exists) takes that tag's display name, so the name sent with it is not applied.
// Otherwise the name is set first, and `changeTagSlug` then keeps it — a name the form sent
// unchanged that still equals the old identifier follows the identifier, as it would alone.
export function updateTag(from: string, rawName: string, rawTo: string): UpdateResult {
  const to = tagSlug(rawTo);
  const moving = normalizeTagName(rawTo).toLowerCase() !== from;
  if (moving) {
    const problem = tagSlugProblem(rawTo);
    if (problem !== null) return { ok: false, error: problem };
    if (to === '') return { ok: false, error: '識別子を入力してください。' };
  }
  const current = listTags().find((tag) => tag.slug === from);
  if (!current) return { ok: false, error: 'タグが見つかりません。' };
  const owner = moving ? resolveTagSlug(to) : null;
  const merging = owner !== null && owner !== from;

  if (!merging && normalizeTagName(rawName) !== current.name) {
    const renamed = renameTag(from, rawName);
    if (!renamed.ok) return renamed;
  }
  if (!moving) return { ok: true, slug: from };
  const changed = changeTagSlug(from, rawTo);
  return changed.ok ? { ok: true, slug: changed.slug } : changed;
}

export type AliasResult = { ok: true; alias: string } | { ok: false; error: string };

// Add a word that stands for a tag, under the rules an identifier follows. One word names one tag:
// a word that is already a tag's identifier or any tag's alias is refused.
export function addAlias(slug: string, raw: string): AliasResult {
  const problem = tagSlugProblem(raw);
  if (problem !== null) return { ok: false, error: problem };
  const alias = tagSlug(raw);
  if (alias === '') return { ok: false, error: 'エイリアスを入力してください。' };
  const tag = db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).get();
  if (!tag) return { ok: false, error: 'タグが見つかりません。' };
  if (resolveTagSlug(alias) !== null)
    return { ok: false, error: `「${alias}」は既に使われています。` };
  db.insert(tagAliases).values({ alias, tagId: tag.id }).run();
  return { ok: true, alias };
}

export function removeAlias(alias: string): boolean {
  return db.delete(tagAliases).where(eq(tagAliases.alias, alias)).run().changes > 0;
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
