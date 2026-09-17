import { test, expect } from '@playwright/test';

// The toolbar tooltips are a custom CSS element (not the native `title`), so
// their placement is ours to control. This guards that hovering an icon button
// reveals its label centered directly below the button.
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

// The shortcut of any command that has one is surfaced in its tooltip alongside its name. Every
// ToolbarButton that carries a `shortcut` also carries a `title` now — 大見出し/小見出し were the
// last holdout with a shortcut but no title (their own visible text, 大見出し, doubled as the name)
// until they became the H2/H3 glyphs (docs/table-requirements.md §12.10), which moved them into
// this same shape: the visible glyph is no longer the full name, so `title` restores it. Rendered
// on Linux CI, so "Mod" formats as "Ctrl".
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
