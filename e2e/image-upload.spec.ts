import { test, expect, type Locator, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { expectAutosaved, loadMarkdown, selectAcross, selectInside } from './editor-authoring';

// A minimal valid 1×1 PNG. Uploads are content-addressed (sha256), so re-runs
// dedup to a single file in data/uploads and the GC sweep reclaims it.
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_1x1 = Buffer.from(PNG_1x1_BASE64, 'base64');

// Paste a PNG into the editor, the way a screenshot from the clipboard arrives. The toolbar picker
// is only one of three entry points and the only one with an affordance to grey out; paste and drop
// go straight to uploadImages, which is where the refusals actually live. A dispatched
// ClipboardEvent carrying a real File hits PostEditor's handlePaste exactly as the browser's own
// would.
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

// Drop a PNG onto a specific element, the way a file dragged from the desktop lands. The
// coordinates are the point of the whole thing — useImageUpload reads them with posAtCoords to
// decide where the image goes — so this aims at a real element's centre rather than the origin.
// The listener is on window (PostEditor intercepts the drag there to stop the browser navigating
// to the image), which is what the browser's own drop would reach.
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

// Exercises the image pipeline end-to-end: file → /api/uploads → an inserted
// image node carrying the returned /uploads/ URL.
test('toolbar image upload inserts an uploaded image', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // The 画像 toolbar control wraps a hidden <input type=file>; setInputFiles works
  // on hidden inputs and triggers the same upload path as the picker.
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-pixel.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });

  const img = editor.locator('img');
  await expect(img).toBeVisible({ timeout: 20_000 });
  await expect(img).toHaveAttribute('src', /^\/uploads\/[0-9a-f]+\.png$/);
});

// An image can't live in a table cell: cells are paragraph-only (table-extensions.ts) and the
// image node is a block, so inserting there splits the table in two around it — and the
// headerless half that falls out can't be written as a GFM pipe table, so the saved markdown
// degrades to a raw <table> blob. useImageUpload refuses before it uploads anything, and the
// picker is greyed out to match. Browser-only: the guard reads the live selection.
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

  // Outside the table it uploads and inserts as before — and the table is still one table,
  // written as a pipe table rather than the raw <table> a split would produce.
  await editor.click({ position: { x: 200, y: 400 } });
  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: 'e2e-pixel.png', mimeType: 'image/png', buffer: PNG_1x1 });

  await expect(editor.locator('img')).toBeVisible({ timeout: 20_000 });
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('td img')).toHaveCount(0);
  expect(await page.locator('input[name="body"]').inputValue()).not.toContain('<table');
});

// Same refusal inside a code block, for the same reason with a different corruption: the block
// splits at the caret, so the code breaks mid-token and the second fence loses its own line —
// the backticks and the code after them then render as body text on the published page.
test('the image picker is disabled inside a code block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('```js '); // trailing space commits the fence
  await page.keyboard.type('const a = 1;');
  await expect(editor.locator('.code-block')).toBeVisible();

  await expect(page.getByTestId('image-picker')).toBeDisabled();
  // The code block is untouched: one block, still holding the whole line.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  expect(await page.locator('input[name="body"]').inputValue()).toContain('const a = 1;');
});

// The image node is a block, but tiptap-markdown registers prosemirror-markdown's *inline*
// image serializer for it, which writes `![alt](src)` without closing the block — so whatever
// came next was emitted onto the image's own line. `![alt](src)> 引用です` then reached the
// public pipeline as one paragraph: the image rendered, the `>` and its first line showed up as
// literal body text, and the blockquote lost that line. image-extension.ts adds the closeBlock.
// Browser-only: only the live editor produces this markdown.
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

  // ArrowDown leaves the (block) image; the `> ` rule then opens a real quote below it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('> 引用です');
  await expect(editor.locator('blockquote')).toContainText('引用です');

  // The image's markdown ends its own block: a blank line separates it from the quote, so the
  // `>` starts a line rather than trailing the image.
  const md = await page.locator('input[name="body"]').inputValue();
  // The alt stays empty: an uploaded image gets none, since the file name is not one
  // (useImageUpload.ts). What this line is about is the blank line after the image.
  expect(md).toMatch(/!\[\]\(\/uploads\/[0-9a-f]+\.png\)\n\n> 引用です/);

  // And it survives the round-trip through storage as an image plus a quote, not one paragraph.
  await page.getByLabel('タイトル').fill('画像の次のブロック');
  await expectAutosaved(page);
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor.locator('img')).toBeVisible();
  await expect(editor.locator('blockquote')).toContainText('引用です');
  await expect(editor.locator('blockquote img')).toHaveCount(0);
});

// The two refusals above were written as `editor.isActive('table' | 'codeBlock')`, which only holds
// for a caret. A selection reaching from the paragraph above into either host reported false, and
// setImage then *replaced* the range rather than splitting it: the table disappeared entirely, and
// the code block came out empty — its markdown an empty fence. The guard scans the selected range
// instead (components/editor/selection-scan.ts), and the picker reads the same call so the two
// agree. Browser-only: the guard reads the live selection.
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

    // The picker being greyed out only covers the toolbar; paste reaches uploadImages directly,
    // which is where the refusal actually lives. Dispatch a real paste carrying a PNG.
    await pasteImage(page);
    await expect(editor.locator('img')).toHaveCount(0);
    expect(await docString(page)).toBe(expected);
  });
}

// Positive control for the two refusals above: the same dispatched paste *does* insert when the
// selection is somewhere an image can go. Without this, a paste event the editor silently ignored
// would make those tests pass for the wrong reason.
test('pasting an image inserts it when the selection allows it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, 'text\n\n| a | b |\n| --- | --- |\n| c | d |\n');
  // Place the caret explicitly rather than with Control+Home: that key is not always handled (it is
  // an OS/browser-level shortcut and ProseMirror does not own it), and when it failed to move the
  // caret it stayed where setContent left it — inside the table — so the paste was *correctly*
  // refused and this test failed for the wrong reason. The refusal notice had already expired by
  // the time the 20s assertion gave up, which is why the failure looked like "nothing happened".
  await selectInside(page, 'paragraph');
  await pasteImage(page);

  const img = editor.locator('img');
  await expect(img).toBeVisible({ timeout: 20_000 });
  await expect(img).toHaveAttribute('src', /^\/uploads\/[0-9a-f]+\.png$/);
  // An accepted paste says nothing — the notice is only for a refusal.
  await expect(page.getByRole('status')).toHaveCount(0);
  // The table is untouched — one table, still a pipe table in the saved markdown.
  await expect(editor.locator('table')).toHaveCount(1);
  expect(await page.locator('input[name="body"]').inputValue()).not.toContain('<table');
});

// The picker greys itself out where an insert can't land, but paste and drag-and-drop have no
// control to grey — before the toast they simply did nothing, with no way to tell why. The notice
// hangs off the sticky toolbar so it stays in view over the content (EditorToast), announces itself
// as role=status, and clears itself after three seconds. It names the host in the way rather than
// reciting both rules, and says 「には」 not 「の中には」 — the guard fires on a selection *touching* a
// host, and a range that merely reaches into one leaves the caret outside it.
//
// Spelled out here rather than imported from useImageUpload. This is user-visible copy, so the test
// should pin it independently: importing the constant would let the wording change with every test
// still green, and noticing that change is the whole point of asserting on it.
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

    // Three seconds, so it must be gone well inside this budget — and not before it can be read.
    await expect(toast).toHaveCount(0, { timeout: 8_000 });
  });
}

// The drop path reaches the same refusal (PostEditor's window-level drop handler calls
// uploadImages), so it gets the same notice. The window listener is what the browser's own drop
// would reach, so dispatching there exercises the real handler.
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

// One selection can touch both hosts — here a range running from the leading paragraph through the
// table and into the code block. Naming one of them would be half the truth, so that case keeps the
// message that recites both.
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

// A dropped image lands where it was dropped. It used to go wherever the caret happened to be when
// the drag started, so aiming at the second paragraph put the image beside the first — the drop
// coordinates were read for nothing. useImageUpload now moves the selection to posAtCoords first.
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

  // Aim at the last paragraph, far from the caret.
  await dropImageAt(page, editor.getByText('三つ目'));
  await expect(editor.locator('img')).toBeVisible({ timeout: 20_000 });

  // The image sits by the paragraph it was aimed at, and the first paragraph is untouched.
  const doc = await docString(page);
  expect(doc).toContain('paragraph("一つ目"), paragraph("二つ目")');
  expect(doc).toMatch(
    /paragraph\("二つ目"\), (image, paragraph\("三つ目"\)|paragraph\("三つ目"\), image)/,
  );
});

// And the refusal now follows the drop point rather than the caret: dropping onto a table is
// refused even though the caret sits in a perfectly valid paragraph, and the notice names the table.
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
