import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME } from '@/app/shared-metadata';
import { db } from '@/lib/db';
import { appSettings, posts } from '@/lib/db/schema';
import { readPinnedPostId } from '@/lib/pinned-post';
import { readSiteIdentity, saveSiteIdentity } from '@/lib/site-settings';
import { SHARE_IMAGE_INVALID, SITE_NAME_REQUIRED } from '@/lib/site-settings-rules';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});
const admin = vi.hoisted(() => ({ current: true }));
vi.mock('@/lib/dal', () => ({ isAdmin: async () => admin.current }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import * as settingsActions from './settings';
const { saveSiteSettingsAction, pinPostAction } = settingsActions;

function form(name: string, description: string, shareImage = ''): FormData {
  const data = new FormData();
  data.set('name', name);
  data.set('description', description);
  data.set('shareImage', shareImage);
  return data;
}

beforeEach(() => {
  db.delete(appSettings).run();
  admin.current = true;
});

// docs/site-settings-requirements.md §6.
describe('site settings', () => {
  it('reads the defaults while nothing is saved (id=1)', () => {
    expect(readSiteIdentity()).toEqual({
      name: DEFAULT_SITE_NAME,
      description: DEFAULT_SITE_DESCRIPTION,
      shareImage: '',
    });
  });

  it('reads back what was saved, an empty description included', () => {
    saveSiteIdentity({ name: 'Renamed', description: '', shareImage: '/uploads/a.png' });
    expect(readSiteIdentity()).toEqual({
      name: 'Renamed',
      description: '',
      shareImage: '/uploads/a.png',
    });
    saveSiteIdentity({ name: 'Again', description: 'Desc', shareImage: '' });
    expect(readSiteIdentity()).toEqual({ name: 'Again', description: 'Desc', shareImage: '' });
  });

  it('saves an admin’s valid values', async () => {
    const state = await saveSiteSettingsAction({}, form(' Renamed ', 'Desc', '/uploads/a.png'));
    expect(state.at).toBeTypeOf('number');
    expect(readSiteIdentity()).toEqual({
      name: 'Renamed',
      description: 'Desc',
      shareImage: '/uploads/a.png',
    });
  });

  it('refuses a non-admin and writes nothing (id=3)', async () => {
    admin.current = false;
    const state = await saveSiteSettingsAction({}, form('Renamed', 'Desc'));
    expect(state.error).toBeTruthy();
    expect(db.select().from(appSettings).all()).toEqual([]);
  });

  it('refuses invalid values with a reason and writes nothing (id=4)', async () => {
    const state = await saveSiteSettingsAction({}, form('', 'Desc'));
    expect(state.errors).toEqual({ name: SITE_NAME_REQUIRED });
    expect(db.select().from(appSettings).all()).toEqual([]);
  });

  // §6 id=8: an off-site URL would be republished as the site's own card image.
  it('refuses a share image that is not an upload and writes nothing (id=8)', async () => {
    const state = await saveSiteSettingsAction(
      {},
      form('Renamed', 'Desc', 'https://example.com/a.png'),
    );
    expect(state.errors).toEqual({ shareImage: SHARE_IMAGE_INVALID });
    expect(db.select().from(appSettings).all()).toEqual([]);
  });

  // docs/multi-author-requirements.md §7 row 3.
  it('refuses all exports when called by an author and makes no change to the DB', async () => {
    admin.current = false;
    const beforeSettings = db.select().from(appSettings).all();

    const entries = Object.entries(settingsActions).filter(
      ([, value]) => typeof value === 'function',
    );
    expect(entries.length).toBeGreaterThan(0);

    for (const [, fn] of entries) {
      const actionFn = fn as (...args: unknown[]) => Promise<{ error?: string }>;
      const result =
        actionFn.length === 2
          ? await actionFn({}, form('Renamed', 'Desc'))
          : await actionFn(form('Renamed', 'Desc'));

      expect(result).toHaveProperty('error');
      expect(result.error).toBeTruthy();
      expect(db.select().from(appSettings).all()).toEqual(beforeSettings);
    }
  });
});

function seedPost(values: { draft?: boolean; kind?: 'post' | 'scribble' } = {}): number {
  return db
    .insert(posts)
    .values({
      slug: `s${Math.random().toString(16).slice(2)}`,
      title: 'Title',
      date: '2026-01-01',
      description: '',
      category: 'tech',
      tags: [],
      draft: values.draft ?? false,
      body: '',
      unlisted: false,
      kind: values.kind ?? 'post',
    })
    .returning({ id: posts.id })
    .get().id;
}

function idForm(id: number | ''): FormData {
  const data = new FormData();
  data.set('id', String(id));
  return data;
}

// docs/home-requirements.md §3 and §6.
describe('pinning a post to the home page', () => {
  beforeEach(() => {
    db.delete(posts).run();
  });

  it('pins a published post and takes the pin off with an empty id', async () => {
    const id = seedPost();
    expect((await pinPostAction({}, idForm(id))).at).toBeTypeOf('number');
    expect(readPinnedPostId()).toBe(id);
    expect((await pinPostAction({}, idForm(''))).at).toBeTypeOf('number');
    expect(readPinnedPostId()).toBeNull();
  });

  it('refuses a draft, a scribble and an unknown id, and keeps the pin it had', async () => {
    const kept = seedPost();
    await pinPostAction({}, idForm(kept));
    for (const id of [seedPost({ draft: true }), seedPost({ kind: 'scribble' }), 9999]) {
      expect((await pinPostAction({}, idForm(id))).error).toBeTruthy();
    }
    expect(readPinnedPostId()).toBe(kept);
  });

  it('refuses a non-admin and writes nothing', async () => {
    const id = seedPost();
    admin.current = false;
    expect((await pinPostAction({}, idForm(id))).error).toBeTruthy();
    expect(readPinnedPostId()).toBeNull();
  });
});
