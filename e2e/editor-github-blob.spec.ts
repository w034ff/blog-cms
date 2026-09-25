import { test, expect, type Page } from '@playwright/test';
import {
  closeHistory,
  expectAutosaved,
  expectPublished,
  loadMarkdown,
  ensureCategory,
} from './editor-authoring';
import { markdown, shot } from './editor-probe';
import { BLOB_NOTICES } from '../components/editor/github-blob-import';
import { gotoPublished } from './published-post';

// The GitHub blob import (docs/embed-requirements.md §19): an asynchronous button, producing a fence
// observable only through the serializer. **GitHub can be stubbed here**, unlike the gist (§18.10's
// G7): the page itself fetches, so `page.route` sees it. Measured: the URL built, the block written,
// the failure handling.
const BLOB = 'https://github.com/facebook/react/blob/main/packages/react/index.ts';
const RAW = 'https://raw.githubusercontent.com/facebook/react/main/packages/react/index.ts';
const FILE = ["import { a } from 'a';", '', 'export const b = 1;', 'export const c = 2;', ''].join(
  '\n',
);

// The stub records the URL asked for, half of §19.3.
async function stubRaw(
  page: Page,
  reply: { status: number; body?: string; contentType?: string } = { status: 200, body: FILE },
): Promise<string[]> {
  const asked: string[] = [];
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    asked.push(route.request().url());
    await route.fulfill({
      status: reply.status,
      contentType: reply.contentType ?? 'text/plain; charset=utf-8',
      body: reply.body ?? '404: Not Found',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return asked;
}

async function openWith(page: Page, source: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, source);
}

const IMPORT = 'コードブロックにする';

test('the bubble offers the code block, not a card, for a blob URL (§19.2)', async ({ page }) => {
  const asked = await stubRaw(page);
  await openWith(page, `<${BLOB}>\n\n本文\n`);

  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  // One URL, one meaning (§3.3): a card would show a social image and no file.
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toHaveCount(0);
  await shot(page, '01-bubble-blob-button');

  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  // Built from the URL's segments, asking the raw host (§19.3).
  expect(asked).toEqual([RAW]);
  // The fence's language from the extension and the blob URL as filename (§19.4). The whole document:
  // the link's paragraph is replaced, and nothing follows.
  expect(await markdown(page)).toBe(
    [`\`\`\`ts:${BLOB}`, FILE.trimEnd(), '```', '', '本文'].join('\n'),
  );
  // The header links to the file (§19.4).
  const source = page.locator('.ProseMirror .code-block-source');
  await expect(source).toHaveAttribute('href', BLOB);
  await expect(source.locator('.code-block-source-repo')).toHaveText('facebook/react');
  await expect(source.locator('.code-block-source-path')).toHaveText('packages/react/index.ts');
  // The filename field is hidden.
  await expect(page.locator('.ProseMirror .code-block-filename')).toBeHidden();
  await shot(page, '02-editor-code-block');

  // **Reopening is where a filename goes wrong**: slashes and dots fold into
  // `language-ts:packages/react/index.ts`, and `updateCodeBlockDOM` splits at the first colon. So the
  // round trip is measured: the whole path and the language survive.
  const produced = await markdown(page);
  await loadMarkdown(page, produced);
  expect(await markdown(page)).toBe(produced);
  await expect(page.locator('.ProseMirror .code-block-source')).toHaveAttribute('href', BLOB);
  await expect(page.locator('.ProseMirror .code-block-lang')).toHaveValue('ts');
});

test('a line fragment imports only those lines (§19.3)', async ({ page }) => {
  await stubRaw(page);
  await openWith(page, `<${BLOB}#L3-L4>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  expect(await markdown(page)).toBe(
    [
      `\`\`\`ts:${BLOB}#L3-L4`,
      'export const b = 1;',
      'export const c = 2;',
      '```',
      '',
      '本文',
    ].join('\n'),
  );
});

test('one press, one undo (§19.4)', async ({ page }) => {
  await stubRaw(page);
  await openWith(page, `<${BLOB}>\n\n本文\n`);
  // `setContent` is one history event, and the import joined it (before the `uiEvent` meta), so one
  // Ctrl-Z emptied the editor. Closed, so the insertion's own group is what is measured.
  await closeHistory(page);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  // One Ctrl-Z takes the insertion alone (`uiEvent`, github-blob-import.ts).
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  expect(await markdown(page)).toBe(`<${BLOB}>\n\n本文`);
});

test('a file GitHub will not serve leaves the link alone and says so (§19.5)', async ({ page }) => {
  await stubRaw(page, { status: 404 });
  await openWith(page, `<${BLOB}>\n\n本文\n`);
  const toast = page.getByRole('status');
  await expect(toast).toHaveCount(0);

  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();

  await expect(toast).toBeVisible();
  await expect(toast).toHaveText(BLOB_NOTICES.fetch);
  // A failed import costs nothing: the link stays.
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  expect(await markdown(page)).toBe(`<${BLOB}>\n\n本文`);
  await shot(page, '03-fetch-failed');
});

test('a file the import could never take is offered the card instead (§19.2)', async ({ page }) => {
  // A `.png` is not claimed, so it is a card, as Qiita and Zenn treat non-text files, decided from
  // the URL.
  await stubRaw(page);
  await openWith(page, `<https://github.com/facebook/react/blob/main/logo.png>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: IMPORT })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('a binary the extension did not name is refused by the response (§19.5)', async ({ page }) => {
  // The second net: `.dat` gets the button, and GitHub's content-type refuses it.
  await stubRaw(page, { status: 200, body: 'PNG ', contentType: 'image/png' });
  await openWith(page, `<https://github.com/facebook/react/blob/main/blob.dat>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();

  await expect(page.getByRole('status')).toHaveText(BLOB_NOTICES.binary);
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  // The link is untouched.
  expect(await markdown(page)).toBe(
    '<https://github.com/facebook/react/blob/main/blob.dat>\n\n本文',
  );
});

test('a GitHub URL that is not one file keeps the card (§19.2)', async ({ page }) => {
  await stubRaw(page);
  // A repository page has no file: no button, a card. Its absence means something because the one
  // above is present.
  await openWith(page, `<https://github.com/facebook/react>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: IMPORT })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('the import lands where the link ended up, not where it started (§19.4)', async ({ page }) => {
  // The document can change while the fetch is out: the answer is held until a line is typed above
  // the link, so the stored range is stale, and the block must still replace the link.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: FILE,
      headers: { 'access-control-allow-origin': '*' },
    });
  });

  // The link is last, so the edit moves it without touching it; editing its own line aborts on
  // purpose (§19.4). Three lines up: one line up is under the portalled card.
  await openWith(page, `一行目\n\n二行目\n\n三行目\n\n<${BLOB}>\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();

  // Grow the text above while the request is held.
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('足した文字');
  await page.keyboard.press('Enter');

  release();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);
  expect(await markdown(page)).toBe(
    [
      '足した文字',
      '',
      '一行目',
      '',
      '二行目',
      '',
      '三行目',
      '',
      `\`\`\`ts:${BLOB}`,
      FILE.trimEnd(),
      '```',
    ].join('\n'),
  );
  await shot(page, '04-mapped-through-edits');
});

test('the published block wears the same header (§19.4)', async ({ page }) => {
  // The NodeView builds DOM and `lib/rehype-code-source.ts` builds hast from the same string; only
  // this measures the second in place.
  await stubRaw(page);
  await page.goto('/admin/posts/new');
  await page.getByLabel('タイトル').fill('GitHub blob spec');
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `<${BLOB}>\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const source = page.locator('.code-source-link');
  await expect(source).toHaveAttribute('href', BLOB);
  // External, so a new tab (§6).
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(page.locator('.code-source-repo')).toHaveText('facebook/react');
  await expect(page.locator('.code-source-path')).toHaveText('packages/react/index.ts');
  // On the figure, one row above the code.
  const caption = await page.locator('.code-source').boundingBox();
  const pre = await page.locator('[data-rehype-pretty-code-figure] pre').boundingBox();
  expect(caption!.y + caption!.height).toBeLessThanOrEqual(pre!.y + 1);
  await shot(page, '05-published-header');
});

test('an imported block can be turned back into a link (§19.4)', async ({ page }) => {
  await stubRaw(page);
  await openWith(page, `<${BLOB}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);
  await shot(page, '06-to-link-button');

  await page.getByRole('button', { name: 'リンクに戻す' }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  // Back to the exact reference, fragment and all; the block is gone, not emptied.
  expect(await markdown(page)).toBe(`<${BLOB}>\n\n本文`);
  // The bubble offers the import again: a door, not an exit.
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: IMPORT })).toBeVisible();
});

test('an ordinary code block is not offered the way back (§19.4)', async ({ page }) => {
  // Only a block with a reference gets the button.
  await openWith(page, '```ts:index.ts\nconst a = 1;\n```\n');
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);
  await expect(page.locator('.ProseMirror .code-block-filename')).toBeVisible();
  await expect(page.getByRole('button', { name: 'リンクに戻す' })).toHaveCount(0);
});

test('the way back keeps its name when the header goes to icons (§19.4)', async ({ page }) => {
  // Below 30rem the label is hidden visually, keeping the accessible name, as on the card's band.
  await page.setViewportSize({ width: 420, height: 800 });
  await stubRaw(page);
  await openWith(page, `<${BLOB}>\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  const label = page.locator('.code-block-to-link-label');
  await expect(label).toHaveText('リンクに戻す');
  // Hidden by size, not `display: none`, which would take the name.
  expect(await label.boundingBox()).toMatchObject({ width: 1, height: 1 });
  await expect(page.locator('.code-block-to-link svg')).toBeVisible();
  await shot(page, '07-narrow-header');

  // Still the button, same action.
  await page.getByRole('button', { name: 'リンクに戻す' }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  expect(await markdown(page)).toBe(`<${BLOB}>`);
});
