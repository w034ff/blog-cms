import { test, expect } from '@playwright/test';
import { docString } from './editor-probe';
import { expectAutosaved, loadMarkdown, selectAcross, selectInside } from './editor-authoring';

// CalloutMenu inserts a `div.markdown-alert` with a non-editable label chip, the caret in its body,
// round-tripping to `> [!TYPE]`.
test('the callout menu inserts a protected note callout that round-trips', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報' }).click();

  // A callout <div>, not a blockquote.
  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('情報');
  // The marker is an attribute, not text.
  await expect(editor).not.toContainText('[!NOTE]');

  // The caret is in the body.
  await page.keyboard.type('補足の説明です。');
  await expect(callout.locator('.markdown-alert-content')).toContainText('補足の説明です。');
  // Typing cannot degrade it to a quote.
  await expect(callout).toBeVisible();

  // The stored markdown (the hidden body input).
  const body = (await page.locator('input[name="body"]').inputValue()).replace(/\\/g, '');
  expect(body).toContain('> [!NOTE]');
  expect(body).toContain('> 補足の説明です。');
});

// Serialize → store → parse back into the node, as every post loads.
test('a callout survives a reload — markdown parses back into the node', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('Callout round-trip');
  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '警告', exact: true }).click();
  await page.keyboard.type('保存して読み込み直しても壊れない。');

  // Persisted (the URL swaps to the edit page), then reload.
  await expectAutosaved(page);
  await page.reload();

  const callout = page.locator('.ProseMirror div.markdown-alert.markdown-alert-warning');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('警告');
  await expect(callout.locator('.markdown-alert-content')).toContainText(
    '保存して読み込み直しても壊れない。',
  );
  await expect(page.locator('.ProseMirror')).not.toContainText('[!WARNING]');
});

// Inside a callout the menu retypes it in place; callouts never nest.
test('picking a type inside a callout switches it in place (no nesting)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('切り替えテスト');

  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '警告', exact: true }).click();

  // One callout, now a warning, body kept.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  const callout = editor.locator('div.markdown-alert.markdown-alert-warning');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('警告');
  await expect(callout.locator('.markdown-alert-content')).toContainText('切り替えテスト');
});

// The other types, likewise.
for (const { label, type, title } of [
  { label: '警告', type: 'warning', title: '警告' },
  { label: '注意', type: 'caution', title: '注意' },
] as const) {
  test(`the callout menu inserts a ${type} callout`, async ({ page }) => {
    await page.goto('/admin/posts/new');

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.getByRole('button', { name: '囲み枠' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();

    const callout = editor.locator(`div.markdown-alert.markdown-alert-${type}`);
    await expect(callout).toBeVisible();
    await expect(callout.locator('.markdown-alert-title-label')).toHaveText(title);
  });
}

// Top-level only (callout-extension.ts), and not in a quote: `> > [!NOTE]` round-trips, but a quote is
// someone else's words.
test('the callout menu is disabled inside a quote', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  const trigger = page.getByRole('button', { name: '囲み枠' });
  await editor.click();
  await expect(trigger).toBeEnabled(); // top level: a callout can be inserted here

  await page.keyboard.type('> quoted text');
  await expect(trigger).toBeDisabled();

  // The command itself refuses, not only the UI.
  const canSetCallout = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { can(): { setCallout(type: string): boolean } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.can().setCallout('note');
  });
  expect(canSetCallout).toBe(false);
});

// `editor.isActive(...)` holds only for a caret, so a range into a table or quote passed and
// insertContent replaced it. The guard scans the range (selection-scan.ts).
for (const { label, markdown, typeName, expected } of [
  {
    label: 'a table',
    markdown: 'text\n\n| a | b |\n| --- | --- |\n| c | d |\n',
    typeName: 'table',
    expected:
      'doc(paragraph("text"), table(tableRow(tableHeader(paragraph("a")), tableHeader(paragraph("b"))), tableRow(tableCell(paragraph("c")), tableCell(paragraph("d")))), paragraph)',
  },
  {
    label: 'a quote',
    markdown: 'text\n\n> quoted\n',
    typeName: 'blockquote',
    expected: 'doc(paragraph("text"), blockquote(paragraph("quoted")), paragraph)',
  },
]) {
  test(`a selection reaching into ${label} cannot insert a callout`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();

    await loadMarkdown(page, markdown);
    expect(await docString(page)).toBe(expected);

    await selectAcross(page, typeName);
    await expect(page.getByRole('button', { name: '囲み枠' })).toBeDisabled();

    // The command refuses and the document is untouched.
    const inserted = await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror') as
        | (Element & { editor?: { commands: { setCallout(type: string): boolean } } })
        | null;
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      return el.editor.commands.setCallout('note');
    });
    expect(inserted).toBe(false);
    expect(await docString(page)).toBe(expected);
  });
}

// `open` survives disabling (the panel is `open && !disabled`, ToolbarDropdown.tsx), so it reappeared
// on re-enable. setTextSelection changes the selection without mousedown or Escape.
test('a dropdown left open while it gets disabled does not reopen by itself', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, 'text\n\n> quoted\n');
  const trigger = page.getByRole('button', { name: '囲み枠' });
  const item = page.getByRole('button', { name: '情報', exact: true });

  // In the paragraph the menu opens.
  await selectInside(page, 'paragraph');
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(item).toBeVisible();

  // Into the quote: disabled, the panel hides.
  await selectInside(page, 'blockquote');
  await expect(trigger).toBeDisabled();
  await expect(item).toHaveCount(0);

  // Back out: it stays shut until asked.
  await selectInside(page, 'paragraph');
  await expect(trigger).toBeEnabled();
  await expect(item).toHaveCount(0);

  // A real click still opens it.
  await trigger.click();
  await expect(item).toBeVisible();
});

// A selection overlapping a callout retypes it, instead of an empty new one beside the remains
// (`isActive` needs full coverage; selection-scan.ts).
test('a selection overlapping a callout retypes it instead of inserting a new one', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, '前の段落\n\n> [!NOTE]\n>\n> 囲みの中身\n');
  await expect(editor.locator('div.markdown-alert-note')).toHaveCount(1);

  // From the paragraph into the callout's text.
  await selectAcross(page, 'callout');
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '警告', exact: true }).click();

  // One callout, a warning, text intact.
  const callouts = editor.locator('div.markdown-alert');
  await expect(callouts).toHaveCount(1);
  await expect(editor.locator('div.markdown-alert-warning')).toHaveCount(1);
  await expect(callouts).toContainText('囲みの中身');
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落"), callout(paragraph("囲みの中身")), paragraph)',
  );
});
