import { test, expect, type Locator, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { expectAutosaved, loadMarkdown, selectAcross, selectInside } from './editor-authoring';

// A 1×1 PNG; content-addressed uploads dedupe across runs.
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_1x1 = Buffer.from(PNG_1x1_BASE64, 'base64');

// A screenshot paste. Paste and drop go straight to uploadImages, where the refusals live; a real
// File in a ClipboardEvent reaches PostEditor's handlePaste as the browser's would.
async function pasteImage(page: Page): Promise<void> {
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, PNG_1x1_BASE64);
}

// A desktop file drop at a real element's centre: useImageUpload places by posAtCoords. On window,
// where PostEditor intercepts drags.
async function dropImageAt(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('drop target has no box');
  await page.evaluate(
    ({ base64, x, y }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
      window.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { base64: PNG_1x1_BASE64, x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
}

// file → /api/uploads → an image node with the returned URL.
test('toolbar image upload inserts an uploaded image', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // setInputFiles works on the hidden input, the picker's own path.
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-pixel.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });

  const img = editor.locator('img');
  await expect(img).toBeVisible({ timeout: 20_000 });
  await expect(img).toHaveAttribute('src', /^\/uploads\/[0-9a-f]+\.png$/);
});

// Cells are paragraph-only, so an image splits the table and the headerless half saves as raw HTML.
// useImageUpload refuses before uploading; the picker greys out to match.
test('the image picker is disabled inside a table cell', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '2行2列の表を挿入' }).click();

  const picker = page.getByTestId('image-picker');
  await editor.locator('td').first().click();
  await expect(picker).toBeDisabled();

  // Outside, it inserts, and the table stays one pipe table.
  await editor.click({ position: { x: 200, y: 400 } });
  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: 'e2e-pixel.png', mimeType: 'image/png', buffer: PNG_1x1 });

  await expect(editor.locator('img')).toBeVisible({ timeout: 20_000 });
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('td img')).toHaveCount(0);
  expect(await page.locator('input[name="body"]').inputValue()).not.toContain('<table');
});

// In a code block the insert splits the code mid-token and breaks the second fence.
test('the image picker is disabled inside a code block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('```js '); // trailing space commits the fence
  await page.keyboard.type('const a = 1;');
  await expect(editor.locator('.code-block')).toBeVisible();

  await expect(page.getByTestId('image-picker')).toBeDisabled();
  // The code block is untouched.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  expect(await page.locator('input[name="body"]').inputValue()).toContain('const a = 1;');
});

// tiptap-markdown uses prosemirror-markdown's inline image serializer, which does not close the block,
// so the next block landed on the image's line (`![alt](src)> 引用です`). image-extension.ts adds
// the closeBlock.
test('a block right after an image is not glued onto the image line', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('前の段落');
  await page.keyboard.press('Enter');
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-pixel.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(editor.locator('img')).toBeVisible({ timeout: 20_000 });

  // ArrowDown leaves the image; `> ` opens a quote below.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('> 引用です');
  await expect(editor.locator('blockquote')).toContainText('引用です');

  // A blank line separates the image and the quote.
  const md = await page.locator('input[name="body"]').inputValue();
  // Empty alt: a file name is not one (useImageUpload.ts). The blank line is the point.
  expect(md).toMatch(/!\[\]\(\/uploads\/[0-9a-f]+\.png\)\n\n> 引用です/);

  // It survives storage as an image plus a quote.
  await page.getByLabel('タイトル').fill('画像の次のブロック');
  await expectAutosaved(page);
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor.locator('img')).toBeVisible();
  await expect(editor.locator('blockquote')).toContainText('引用です');
  await expect(editor.locator('blockquote img')).toHaveCount(0);
});

// `editor.isActive(...)` holds only for a caret, so a range into a table or code block passed, and
// setImage replaced it. The guard scans the range (selection-scan.ts); the picker reads the same.
for (const { label, markdown, typeName, expected } of [
  {
    label: 'a table',
    markdown: 'text\n\n| a | b |\n| --- | --- |\n| c | d |\n',
    typeName: 'table',
    expected:
      'doc(paragraph("text"), table(tableRow(tableHeader(paragraph("a")), tableHeader(paragraph("b"))), tableRow(tableCell(paragraph("c")), tableCell(paragraph("d")))), paragraph)',
  },
  {
    label: 'a code block',
    markdown: 'text\n\n```js\nconst a = 1;\n```\n',
    typeName: 'codeBlock',
    expected: 'doc(paragraph("text"), codeBlock("const a = 1;\\n"), paragraph)',
  },
]) {
  test(`a selection reaching into ${label} cannot insert an image`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();

    await loadMarkdown(page, markdown);
    expect(await docString(page)).toBe(expected);

    await selectAcross(page, typeName);
    const picker = page.getByTestId('image-picker');
    await expect(picker).toBeDisabled();

    // Paste reaches uploadImages directly, where the refusal lives.
    await pasteImage(page);
    await expect(editor.locator('img')).toHaveCount(0);
    expect(await docString(page)).toBe(expected);
  });
}

// Control: the same paste inserts where allowed, or an ignored paste would pass the refusals.
test('pasting an image inserts it when the selection allows it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, 'text\n\n| a | b |\n| --- | --- |\n| c | d |\n');
  // Explicitly, not Control+Home, which ProseMirror does not own and which sometimes left the caret in
  // the table, making the paste correctly refused.
  await selectInside(page, 'paragraph');
  await pasteImage(page);

  const img = editor.locator('img');
  await expect(img).toBeVisible({ timeout: 20_000 });
  await expect(img).toHaveAttribute('src', /^\/uploads\/[0-9a-f]+\.png$/);
  // An accepted paste says nothing.
  await expect(page.getByRole('status')).toHaveCount(0);
  // One table, still a pipe table.
  await expect(editor.locator('table')).toHaveCount(1);
  expect(await page.locator('input[name="body"]').inputValue()).not.toContain('<table');
});

// Paste and drop have no control to grey, so a refusal raises a notice (EditorToast, role=status,
// three seconds) naming the host in the way. Spelled out, not imported: user-visible copy pinned
// independently.
const BLOCKED_IN_TABLE = '表のセルには画像を挿入できません';
const BLOCKED_IN_CODE_BLOCK = 'コードブロックには画像を挿入できません';
const BLOCKED_IN_BOTH = '表のセルとコードブロックには画像を挿入できません';

const TABLE_MD = 'text\n\n| a | b |\n| --- | --- |\n| c | d |\n';
const CODE_MD = 'text\n\n```js\nconst a = 1;\n```\n';

for (const { label, markdown, typeName, expected } of [
  {
    label: 'a code block',
    markdown: CODE_MD,
    typeName: 'codeBlock',
    expected: BLOCKED_IN_CODE_BLOCK,
  },
  {
    label: 'a table cell',
    markdown: TABLE_MD,
    typeName: 'tableCell',
    expected: BLOCKED_IN_TABLE,
  },
]) {
  test(`a paste refused in ${label} says why, then clears itself`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();

    await loadMarkdown(page, markdown);
    await selectInside(page, typeName);

    const toast = page.getByRole('status');
    await expect(toast).toHaveCount(0); // nothing showing before the refusal

    await pasteImage(page);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText(expected);
    await expect(editor.locator('img')).toHaveCount(0);

    // Three seconds: gone well inside this, not before it can be read.
    await expect(toast).toHaveCount(0, { timeout: 8_000 });
  });
}

// The drop path (PostEditor's window handler) gets the same notice.
test('a drop refused in a code block says why', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, CODE_MD);
  await dropImageAt(page, editor.locator('.code-block'));

  await expect(page.getByRole('status')).toHaveText(BLOCKED_IN_CODE_BLOCK);
  await expect(editor.locator('img')).toHaveCount(0);
});

// A range touching both hosts names both.
test('a paste refused across both hosts names both', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, `${TABLE_MD}\n${CODE_MD}`);
  const before = await docString(page);
  expect(before).toContain('table(');
  expect(before).toContain('codeBlock(');

  await selectAcross(page, 'codeBlock'); // paragraph → … → code block, crossing the table
  await pasteImage(page);

  await expect(page.getByRole('status')).toHaveText(BLOCKED_IN_BOTH);
  await expect(editor.locator('img')).toHaveCount(0);
  expect(await docString(page)).toBe(before);
});

// A drop lands at the drop point (posAtCoords), not the caret.
test('a dropped image lands where it was dropped, not at the caret', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, '一つ目\n\n二つ目\n\n三つ目\n');
  await selectInside(page, 'paragraph'); // caret parked in the FIRST paragraph
  expect(await docString(page)).toBe(
    'doc(paragraph("一つ目"), paragraph("二つ目"), paragraph("三つ目"))',
  );

  // Far from the caret.
  await dropImageAt(page, editor.getByText('三つ目'));
  await expect(editor.locator('img')).toBeVisible({ timeout: 20_000 });

  // Beside the aimed paragraph; the first is untouched.
  const doc = await docString(page);
  expect(doc).toContain('paragraph("一つ目"), paragraph("二つ目")');
  expect(doc).toMatch(
    /paragraph\("二つ目"\), (image, paragraph\("三つ目"\)|paragraph\("三つ目"\), image)/,
  );
});

// The refusal follows the drop point: a drop on a table is refused with the caret elsewhere.
test('a drop onto a table is refused even when the caret is elsewhere', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, TABLE_MD);
  await selectInside(page, 'paragraph'); // caret in the leading paragraph — an allowed spot
  const before = await docString(page);

  await dropImageAt(page, editor.locator('td').first());

  await expect(page.getByRole('status')).toHaveText(BLOCKED_IN_TABLE);
  await expect(editor.locator('img')).toHaveCount(0);
  expect(await docString(page)).toBe(before);
});
