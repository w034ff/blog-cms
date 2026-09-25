import { test, expect } from '@playwright/test';

// Tooltips are our own element, not `title`: hovering reveals the label centred below the button.
test('toolbar tooltip appears centered below the button on hover', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const bold = page.getByRole('button', { name: '太字' });
  await expect(bold).toBeVisible();
  const tip = bold.locator('span', { hasText: '太字' });

  // Hidden until hover (opacity-0), revealed on hover (opacity-100).
  await expect(tip).toHaveCSS('opacity', '0');
  await bold.hover();
  await expect(tip).toHaveCSS('opacity', '1');

  const btn = await bold.boundingBox();
  const label = await tip.boundingBox();
  if (!btn || !label) throw new Error('missing bounding boxes');

  // Horizontally centered on the button…
  const btnCenter = btn.x + btn.width / 2;
  const tipCenter = label.x + label.width / 2;
  expect(Math.abs(tipCenter - btnCenter)).toBeLessThanOrEqual(1.5);

  // …and sitting below it.
  expect(label.y).toBeGreaterThanOrEqual(btn.y + btn.height);
});

// A command's shortcut appears in its tooltip. Every ToolbarButton with a `shortcut` has a `title`,
// including the H2/H3 glyphs (docs/editor-requirements.md §12.10). On Linux "Mod" reads "Ctrl".
test('toolbar tooltips include keyboard shortcuts', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const bold = page.getByRole('button', { name: '太字' });
  await expect(bold).toContainText('太字');
  await expect(bold).toContainText('Ctrl+B');
  await expect(bold).toHaveAttribute('aria-keyshortcuts', 'Control+B');

  const strike = page.getByRole('button', { name: '取り消し線' });
  await expect(strike).toContainText('Ctrl+Shift+S');

  const heading2 = page.getByRole('button', { name: '大見出し' });
  await expect(heading2).toContainText('大見出し');
  await expect(heading2).toContainText('Ctrl+Alt+2');
  await expect(heading2).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+2');

  // A command without a shortcut gets no shortcut text.
  const list = page.getByRole('button', { name: 'リスト' });
  await expect(list).not.toHaveAttribute('aria-keyshortcuts', /.+/);
});
