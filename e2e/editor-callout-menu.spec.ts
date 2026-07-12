import { test, expect } from '@playwright/test';

// Drives the toolbar's callout-insert menu (CalloutMenu): open the dropdown, pick a
// type, and confirm it drops a real callout node — a `div.markdown-alert` whose label is
// a non-editable chip (no editable marker text) and whose body takes the caret — that
// round-trips to `> [!TYPE]` markdown. Browser-only: the node/NodeView and the markdown
// serialization only exist in the live editor.
test('the callout menu inserts a protected note callout that round-trips', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: 'コールアウト' }).click();
  await page.getByRole('button', { name: '情報' }).click();

  // A callout <div> (not a blockquote), tinted, with the type as a label chip.
  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('情報');
  // The marker is an attribute, never editable text.
  await expect(editor).not.toContainText('[!NOTE]');

  // The caret sits in the empty body, so typing (no extra click) fills the body.
  await page.keyboard.type('補足の説明です。');
  await expect(callout.locator('.markdown-alert-content')).toContainText('補足の説明です。');
  // Still a callout after typing — nothing the author types can degrade it to a quote.
  await expect(callout).toBeVisible();

  // Round-trips to the stored markdown (mirrored into the hidden body input).
  const body = (await page.locator('input[name="body"]').inputValue()).replace(/\\/g, '');
  expect(body).toContain('> [!NOTE]');
  expect(body).toContain('> 補足の説明です。');
});

// Round-trip through storage: a callout saved as `> [!TYPE]` markdown must parse back
// into the same protected node on load (the path every existing post takes). Authoring +
// autosave + reload exercises serialize → store → parse.updateDOM in one go.
test('a callout survives a reload — markdown parses back into the node', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('Callout round-trip');
  await editor.click();
  await page.getByRole('button', { name: 'コールアウト' }).click();
  await page.getByRole('button', { name: '警告', exact: true }).click();
  await page.keyboard.type('保存して読み込み直しても壊れない。');

  // Wait for autosave to persist the markdown (it also swaps the URL to the edit page),
  // then reload so the editor rebuilds from the stored source.
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  const callout = page.locator('.ProseMirror div.markdown-alert.markdown-alert-warning');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('警告');
  await expect(callout.locator('.markdown-alert-content')).toContainText(
    '保存して読み込み直しても壊れない。',
  );
  await expect(page.locator('.ProseMirror')).not.toContainText('[!WARNING]');
});

// The other two tiers wire the same way — assert each menu choice inserts a callout node
// carrying the matching type + label.
for (const { label, type, title } of [
  { label: '警告', type: 'warning', title: '警告' },
  { label: '注意', type: 'caution', title: '注意' },
] as const) {
  test(`the callout menu inserts a ${type} callout`, async ({ page }) => {
    await page.goto('/admin/posts/new');

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.getByRole('button', { name: 'コールアウト' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();

    const callout = editor.locator(`div.markdown-alert.markdown-alert-${type}`);
    await expect(callout).toBeVisible();
    await expect(callout.locator('.markdown-alert-title-label')).toHaveText(title);
  });
}
