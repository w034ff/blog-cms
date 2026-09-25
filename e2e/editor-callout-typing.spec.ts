import { test, expect } from '@playwright/test';

// Callout shortcuts (callout-extension.ts) commit on a space or Enter; the marker becomes a
// non-editable chip, so typing after `]` cannot break it.
test('typing `> [!WARNING]` + Enter upgrades the blockquote to a protected callout node', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('> [!WARNING]');
  await page.keyboard.press('Enter'); // commit, like `#`/`>`

  // A callout <div>, not a <blockquote>.
  const callout = editor.locator('div.markdown-alert.markdown-alert-warning');
  await expect(callout).toBeVisible();
  await expect(editor.locator('blockquote')).toHaveCount(0);
  // The type is the chip (screen-reader text), not the marker.
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('警告');

  // The caret is in the body; the marker never exists as text.
  await page.keyboard.type('注意事項です。');
  await expect(callout.locator('.markdown-alert-content')).toContainText('注意事項です。');
  await expect(editor).not.toContainText('[!WARNING]');
  // Still a callout after typing.
  await expect(callout).toBeVisible();
});

// `:::info`/`:::warning`/`:::danger` map by severity to note/caution/warning, on a trailing space.
for (const { directive, type, title } of [
  { directive: ':::info', type: 'note', title: '情報' },
  { directive: ':::warning', type: 'caution', title: '注意' },
  { directive: ':::danger', type: 'warning', title: '警告' },
] as const) {
  test(`typing \`${directive}\` + space inserts a ${type} callout`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.keyboard.type(`${directive} `); // trailing space commits it

    // The directive line became the node.
    const callout = editor.locator(`div.markdown-alert.markdown-alert-${type}`);
    await expect(callout).toBeVisible();
    await expect(callout.locator('.markdown-alert-title-label')).toHaveText(title);
    await expect(editor).not.toContainText(directive);

    // The caret is in the body.
    await page.keyboard.type('本文です。');
    await expect(callout.locator('.markdown-alert-content')).toContainText('本文です。');
  });
}

// Uncommitted, `:::info` stays text, as `##` does.
test('a bare `:::info` (no space/Enter) stays plain text', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type(':::info');
  await expect(editor.locator('div.markdown-alert')).toHaveCount(0);
  await expect(editor).toContainText(':::info');
});

test('an ordinary blockquote is left as a plain quote', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('> ただの引用です。');

  const quote = editor.locator('blockquote').first();
  await expect(quote).toBeVisible();
  await expect(quote).not.toHaveClass(/markdown-alert/);
  await expect(editor.locator('div.markdown-alert')).toHaveCount(0);
});
