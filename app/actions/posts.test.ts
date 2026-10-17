import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { posts } from '@/lib/db/schema';
import { createPost } from '@/lib/posts-write';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});
// Not 1, so an author written from anywhere but the session cannot match it by accident.
const SESSION_USER_ID = 7;
vi.mock('@/lib/dal', () => ({
  getOptionalSession: async () => ({ userId: SESSION_USER_ID, username: 'admin' }),
  verifySession: async () => ({ userId: SESSION_USER_ID, username: 'admin' }),
}));
// Outside a request there is no cache to revalidate.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { submitPostAction } = await import('./posts');

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    title: 'メモ',
    category: '',
    tags: '',
    body: '本文',
    thumbnail: '',
    ...fields,
  })) {
    data.set(name, value);
  }
  return data;
}

function row(id: number) {
  const found = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!found) throw new Error(`post ${id} is gone`);
  return found;
}

function seedDraft(kind: 'post' | 'scribble'): number {
  return createPost({
    slug: `slug-${kind}`,
    title: 'メモ',
    date: '',
    category: '',
    tags: [],
    draft: true,
    body: '本文',
    thumbnail: '',
    kind,
    authorId: 1,
  });
}

beforeEach(() => {
  db.delete(posts).run();
});

// docs/scribble-requirements.md §3.2: a scribble has no category to choose, so publish does not ask
// for one, and what it stores is empty whatever the form carried.
describe('submitPostAction and kinds', () => {
  it('publishes a scribble without a category, storing neither category nor thumbnail', async () => {
    const id = seedDraft('scribble');
    const state = await submitPostAction(
      {},
      form({ id: String(id), category: 'tech', thumbnail: '/uploads/a.png' }),
    );
    expect(state.saved?.published).toBe(true);
    expect(row(id)).toMatchObject({ kind: 'scribble', draft: false, category: '', thumbnail: '' });
  });

  it('still refuses a post with no category', async () => {
    const id = seedDraft('post');
    const state = await submitPostAction({}, form({ id: String(id) }));
    expect(state.missingCategory).toBe(true);
    expect(row(id).draft).toBe(true);
  });

  it('creates a scribble when publish comes before any autosave', async () => {
    const state = await submitPostAction({}, form({ kind: 'scribble' }));
    const id = state.saved?.id;
    if (id === undefined) throw new Error(`not saved: ${JSON.stringify(state)}`);
    expect(row(id)).toMatchObject({ kind: 'scribble', draft: false });
  });

  // docs/library-requirements.md §8 row 2.
  it("writes the session's account as the author when publish creates the row", async () => {
    const state = await submitPostAction({}, form({ category: 'tech' }));
    const id = state.saved?.id;
    if (id === undefined) throw new Error(`not saved: ${JSON.stringify(state)}`);
    expect(row(id)).toMatchObject({ kind: 'post', authorId: SESSION_USER_ID });
  });

  it("ignores a kind sent for an existing row, and unpublish keeps a scribble's fields empty", async () => {
    const id = seedDraft('scribble');
    await submitPostAction({}, form({ id: String(id), kind: 'post' }));
    await submitPostAction(
      {},
      form({ id: String(id), intent: 'unpublish', category: 'tech', thumbnail: '/uploads/a.png' }),
    );
    expect(row(id)).toMatchObject({ kind: 'scribble', draft: true, category: '', thumbnail: '' });
  });

  it('returns editedAt in saved on publish and unpublish', async () => {
    const id = seedDraft('post');
    const pubState = await submitPostAction(
      {},
      form({ id: String(id), category: 'tech' }),
    );
    expect(pubState.saved?.published).toBe(true);
    expect(typeof pubState.saved?.editedAt).toBe('string');
    expect(row(id).editedAt).toBe(pubState.saved?.editedAt);

    const unpubState = await submitPostAction(
      {},
      form({ id: String(id), intent: 'unpublish', category: 'tech' }),
    );
    expect(unpubState.saved?.published).toBe(false);
    expect(typeof unpubState.saved?.editedAt).toBe('string');
    expect(row(id).editedAt).toBe(unpubState.saved?.editedAt);
  });
});
