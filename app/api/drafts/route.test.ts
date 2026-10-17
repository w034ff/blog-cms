import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { posts } from '@/lib/db/schema';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});
// Not 1, so an author written from anywhere but the session cannot match it by accident.
const SESSION_USER_ID = 7;
vi.mock('@/lib/dal', () => ({
  getOptionalSession: async () => ({ userId: SESSION_USER_ID, username: 'admin' }),
}));

const { POST } = await import('./route');

// What the editor would send for a scribble if it still showed the fields it hides: a category and
// an upload path, both of which a scribble cannot hold (docs/scribble-requirements.md §3.2).
const filled = {
  title: 'メモ',
  category: 'tech',
  tags: [],
  body: '本文',
  thumbnail: '/uploads/a.png',
};

function save(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function row(id: number) {
  const found = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!found) throw new Error(`post ${id} is gone`);
  return found;
}

async function create(body: unknown): Promise<number> {
  const json: unknown = await (await save(body)).json();
  if (typeof json !== 'object' || json === null || !('id' in json) || typeof json.id !== 'number') {
    throw new Error(`no row was created: ${JSON.stringify(json)}`);
  }
  return json.id;
}

beforeEach(() => {
  db.delete(posts).run();
});

// docs/library-requirements.md §8 row 2.
describe('POST /api/drafts and the author', () => {
  it("writes the session's account as a new row's author, for either kind", async () => {
    const post = await create({ content: filled });
    const scribble = await create({ kind: 'scribble', content: filled });
    expect(row(post).authorId).toBe(SESSION_USER_ID);
    expect(row(scribble).authorId).toBe(SESSION_USER_ID);
  });
});

describe('POST /api/drafts and kinds', () => {
  it('creates a scribble with no category and no thumbnail, whatever was sent', async () => {
    const id = await create({ kind: 'scribble', content: filled });
    expect(row(id)).toMatchObject({ kind: 'scribble', category: '', thumbnail: '', draft: true });
  });

  it('creates a post when the kind is missing or unknown', async () => {
    const missing = await create({ content: filled });
    const unknown = await create({ kind: 'page', content: filled });
    expect(row(missing)).toMatchObject({ kind: 'post', category: 'tech' });
    expect(row(unknown).kind).toBe('post');
  });

  it("keeps a row's kind on update, and a scribble's fields empty", async () => {
    const scribble = await create({ kind: 'scribble', content: filled });
    const post = await create({ content: filled });

    await save({ id: scribble, kind: 'post', content: { ...filled, body: '更新' } });
    await save({ id: post, kind: 'scribble', content: { ...filled, body: '更新' } });

    expect(row(scribble)).toMatchObject({ kind: 'scribble', category: '', thumbnail: '' });
    expect(row(scribble).body).toBe('更新');
    expect(row(post)).toMatchObject({ kind: 'post', category: 'tech' });
  });

  it('returns editedAt on creation and update, but not when skipped', async () => {
    const createRes = await (await save({ content: filled })).json();
    expect(typeof createRes.editedAt).toBe('string');
    expect(row(createRes.id).editedAt).toBe(createRes.editedAt);

    const updateRes = await (
      await save({ id: createRes.id, content: { ...filled, title: '新しいタイトル' } })
    ).json();
    expect(typeof updateRes.editedAt).toBe('string');
    expect(row(createRes.id).editedAt).toBe(updateRes.editedAt);

    const skipRes = await (await save({ content: { ...filled, title: '', body: '' } })).json();
    expect(skipRes.skipped).toBe(true);
    expect(skipRes.editedAt).toBeUndefined();
  });
});
