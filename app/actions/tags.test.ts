import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { tagAliases, tags } from '@/lib/db/schema';
import * as tagsActions from './tags';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const admin = vi.hoisted(() => ({ current: false }));
vi.mock('@/lib/dal', () => ({
  isAdmin: async () => admin.current,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

beforeEach(() => {
  db.delete(tagAliases).run();
  db.delete(tags).run();
  admin.current = false;
});

function form(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

// docs/multi-author-requirements.md §7 row 3.
describe('tag actions called by an author (all exports of tags.ts)', () => {
  it('refuses all exports and makes no change to the DB', async () => {
    admin.current = false;

    // Seed initial tags and aliases
    const tag = db
      .insert(tags)
      .values({ slug: 'initial', name: 'Initial' })
      .returning({ id: tags.id })
      .get();
    db.insert(tagAliases).values({ alias: 'init-alias', tagId: tag.id }).run();

    const beforeTags = db.select().from(tags).all();
    const beforeAliases = db.select().from(tagAliases).all();

    const formData = form({
      name: 'Attempted Tag',
      slug: 'initial',
      to: 'target',
      alias: 'attempted-alias',
    });

    const entries = Object.entries(tagsActions).filter(([, value]) => typeof value === 'function');
    expect(entries.length).toBeGreaterThan(0);

    for (const [, fn] of entries) {
      const actionFn = fn as (...args: unknown[]) => Promise<{ error?: string }>;
      const result =
        actionFn.length === 2 ? await actionFn({}, formData) : await actionFn(formData);

      expect(result).toHaveProperty('error');
      expect(result.error).toBeTruthy();

      expect(db.select().from(tags).all()).toEqual(beforeTags);
      expect(db.select().from(tagAliases).all()).toEqual(beforeAliases);
    }
  });
});
