import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import { BODY_MAX_CHARS } from '@/lib/body-limit';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});
const currentSession = vi.hoisted(() => ({
  userId: 7,
  username: 'admin',
}));
const SESSION_USER_ID = currentSession.userId;
vi.mock('@/lib/dal', () => ({
  getOptionalSession: async () => currentSession,
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
  db.delete(users).run();
  currentSession.userId = SESSION_USER_ID;
  currentSession.username = 'admin';

  db.insert(users)
    .values({
      id: SESSION_USER_ID,
      username: 'admin',
      passwordHash: 'dummy',
      role: 'admin',
    })
    .run();
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

  it('returns 404 when updating a post that does not exist', async () => {
    const res = await save({ id: 999999, content: filled });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('not found');
  });
});

// docs/multi-author-requirements.md §7 row 4.
describe('POST /api/drafts author permissions', () => {
  it('returns 403 and does not change the DB when an author autosaves another’s post', async () => {
    const OTHER_AUTHOR_ID = 99;
    const AUTHOR_USER_ID = 8;

    db.insert(users)
      .values({
        id: AUTHOR_USER_ID,
        username: 'author',
        passwordHash: 'dummy',
        role: 'author',
      })
      .run();

    // Create a post belonging to other author
    const otherPostId = await create({ content: filled });
    db.update(posts).set({ authorId: OTHER_AUTHOR_ID }).where(eq(posts.id, otherPostId)).run();
    const beforeState = row(otherPostId);

    // Switch to author session
    currentSession.userId = AUTHOR_USER_ID;
    currentSession.username = 'author';

    const res = await save({
      id: otherPostId,
      content: { ...filled, title: 'Hacked Title', body: 'Hacked Body' },
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('forbidden');

    // DB remains completely unchanged
    expect(row(otherPostId)).toEqual(beforeState);
  });
});

// docs/abuse-limits-requirements.md §8 row 10.
describe('POST /api/drafts and the body limit', () => {
  const atLimit = 'あ'.repeat(BODY_MAX_CHARS);

  it('refuses a body over the limit with 413 and writes nothing, for a new row', async () => {
    const res = await save({ content: { ...filled, body: `${atLimit}い` } });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'body too long' });
    expect(db.select().from(posts).all()).toEqual([]);
  });

  it('refuses it for an existing row, leaving the row as it was', async () => {
    const id = await create({ content: filled });
    const before = row(id);
    const res = await save({ id, content: { ...filled, body: `${atLimit}い` } });
    expect(res.status).toBe(413);
    expect(row(id)).toEqual(before);
  });

  it('refuses it for a published post’s working copy too', async () => {
    const id = await create({ content: filled });
    db.update(posts).set({ draft: false }).where(eq(posts.id, id)).run();
    const before = row(id);
    expect((await save({ id, content: { ...filled, body: `${atLimit}い` } })).status).toBe(413);
    expect(row(id)).toEqual(before);
  });

  it('accepts a body of exactly the limit', async () => {
    const id = await create({ content: { ...filled, body: atLimit } });
    expect(row(id).body).toBe(atLimit);
  });

  it('counts code points, so an emoji is one character', async () => {
    const id = await create({ content: { ...filled, body: '😀'.repeat(BODY_MAX_CHARS) } });
    expect(Array.from(row(id).body)).toHaveLength(BODY_MAX_CHARS);
    expect(
      (await save({ id, content: { ...filled, body: `${'😀'.repeat(BODY_MAX_CHARS)}a` } })).status,
    ).toBe(413);
  });
});
