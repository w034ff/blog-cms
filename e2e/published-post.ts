import Database from 'better-sqlite3';
import { expect, type Page } from '@playwright/test';
import { TEST_DB_PATH } from './constants';

// The opaque public slug of the post the editor holds. Assigned at row creation, drafts included,
// and never changed (app/api/drafts/route.ts, the note on `slug` in lib/db/schema.ts), so no
// publish is needed. The editor screen does not show it, so it is read from the hidden `id` input
// and the harness's own DB copy (e2e/prepare-db.mts), whose only writer is the test server.
export async function postSlug(page: Page): Promise<string> {
  const id = await page.locator('input[name="id"]').inputValue();
  expect(id, 'the editor has no row id yet — has the first autosave landed?').toMatch(/^\d+$/);

  const db = new Database(TEST_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT slug FROM posts WHERE id = ?').get(Number(id)) as
      { slug: string | null } | undefined;
    expect(row, `no post row with id ${id}`).toBeTruthy();
    // The slug's shape.
    expect(row?.slug, `post ${id} has no slug`).toMatch(/^[0-9a-f]+$/);
    return row?.slug as string;
  } finally {
    db.close();
  }
}

// Where that post lives on the public site. Only a published post is actually served there
// (`getPostBySlug` returns null for a draft), so callers publish first.
export async function publishedPath(page: Page): Promise<string> {
  return `/posts/${await postSlug(page)}`;
}

// The same, followed by the navigation every caller made next.
export async function gotoPublished(page: Page): Promise<string> {
  const path = await publishedPath(page);
  await page.goto(path);
  return path;
}
