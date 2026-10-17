import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME } from '@/app/shared-metadata';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import { readSiteIdentity, saveSiteIdentity } from '@/lib/site-settings';
import { SITE_NAME_REQUIRED } from '@/lib/site-settings-rules';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});
const admin = vi.hoisted(() => ({ current: true }));
vi.mock('@/lib/dal', () => ({ isAdmin: async () => admin.current }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import * as settingsActions from './settings';
const { saveSiteSettingsAction } = settingsActions;

function form(name: string, description: string): FormData {
  const data = new FormData();
  data.set('name', name);
  data.set('description', description);
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
    });
  });

  it('reads back what was saved, an empty description included', () => {
    saveSiteIdentity({ name: 'Renamed', description: '' });
    expect(readSiteIdentity()).toEqual({ name: 'Renamed', description: '' });
    saveSiteIdentity({ name: 'Again', description: 'Desc' });
    expect(readSiteIdentity()).toEqual({ name: 'Again', description: 'Desc' });
  });

  it('saves an admin’s valid values', async () => {
    const state = await saveSiteSettingsAction({}, form(' Renamed ', 'Desc'));
    expect(state.at).toBeTypeOf('number');
    expect(readSiteIdentity()).toEqual({ name: 'Renamed', description: 'Desc' });
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
