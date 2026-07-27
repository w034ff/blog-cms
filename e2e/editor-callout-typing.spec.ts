import { test, expect } from '@playwright/test';

// The callout typing shortcuts (components/editor/callout-extension.ts) commit with a
// trailing space or Enter, like `#`/`>`. `> [!WARNING]` + Enter upgrades the blockquote
// into a real callout node: the marker becomes a non-editable label chip and only the body
// stays editable, so it can't be broken by typing after the `]`. Browser-only — the input
// rules and NodeView only exist in the live editor.
test('typing `> [!WARNING]` + Enter upgrades the blockquote to a protected callout node', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('> [!WARNING]');
  await page.keyboard.press('Enter'); // commit, like `#`/`>`

  // The blockquote became a callout <div> (not a <blockquote>), tinted for the type.
  const callout = editor.locator('div.markdown-alert.markdown-alert-warning');
  await expect(callout).toBeVisible();
  await expect(editor.locator('blockquote')).toHaveCount(0);
  // The type shows as the non-editable label chip (screen-reader text), not the marker.
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('警告');

  // The caret was left in the empty body, so typing fills the body, and the `[!WARNING]`
  // marker never exists as editable text.
  await page.keyboard.type('注意事項です。');
  await expect(callout.locator('.markdown-alert-content')).toContainText('注意事項です。');
  await expect(editor).not.toContainText('[!WARNING]');
  // Still a callout after typing — the marker can't be corrupted into a plain quote.
  await expect(callout).toBeVisible();
});

// The `:::` shortcut maps to the same node: `:::info`, `:::warning`, `:::danger` follow the
// unambiguous info < warning < danger severity ladder → note / caution / warning, committed
// with a trailing space.
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

    // The directive line became the callout node — its text is gone, replaced by the chip.
    const callout = editor.locator(`div.markdown-alert.markdown-alert-${type}`);
    await expect(callout).toBeVisible();
    await expect(callout.locator('.markdown-alert-title-label')).toHaveText(title);
    await expect(editor).not.toContainText(directive);

    // The caret was left in the body, so typing (no extra key) fills it.
    await page.keyboard.type('本文です。');
    await expect(callout.locator('.markdown-alert-content')).toContainText('本文です。');
  });
}

// The shortcuts only fire once committed: a bare `:::info` with no space/Enter is still
// plain text (matching how `##` stays text until you press space).
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
