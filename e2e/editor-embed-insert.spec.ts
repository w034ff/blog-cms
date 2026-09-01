import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, setRange } from './editor-authoring';
import type { Editor } from '@tiptap/react';
import { markdown, settle } from './editor-probe';

// The embed's own door (docs/embed-requirements.md §24.1). Browser-only twice over: the slash
// menu's filtering runs in the editor, and the dialog is React rendered beside it.
//
// A URL each of two providers claims, and one no provider does. The first two come from
// `lib/embed-provider.test.ts`'s own fixtures, so a shape that stops resolving fails there first,
// where the reason is visible.
const YOUTUBE = 'https://www.youtube.com/watch?v=hDPybQwAuVo';
const CODEPEN = 'https://codepen.io/flatsato/pen/VwqprLp';
const UNCLAIMED = 'https://example.com/an-article';

async function openMenu(page: Page, query: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(`/${query}`);
  await expect(page.locator('[data-slash-menu]')).toBeVisible();
}

function dialog(page: Page) {
  return page.getByRole('dialog');
}

// **This is the whole argument for not adding a permanent button.** The reference site opens its
// embed dialog from a 「+」 in the editor chrome, because its editor writes markdown and the syntax
// cannot be remembered. Here the row is found by searching for what the author is holding — and
// untested, that is a hope rather than a mechanism.
test('the embed row is found by the provider an author is thinking of (24a)', async ({ page }) => {
  for (const query of ['youtube', 'figma', 'スライド', 'gist', 'twitter', '埋め込み']) {
    await openMenu(page, query);
    const menu = page.locator('[data-slash-menu]');
    await expect(menu.getByRole('button', { name: '埋め込み' }), query).toBeVisible();
  }
});

// The row must not open a dialog whose insert would then refuse, so it asks the same predicate the
// insert will meet. A table cell is paragraph-only, which is where the link card's row already
// drops out (link-card-requirements.md §5.4).
test('the embed row is not offered where an embed cannot land (24b)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| c | d |\n');
  await page.locator('.ProseMirror td').first().click();
  await page.keyboard.type('/');
  // Every row refuses in a cell, so the trigger itself stays inert — `/` is an ordinary character
  // and no menu opens at all (slash-command.ts's `allow`). Asserting the row's absence inside an
  // open menu would be asserting against a menu that is not there.
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
  expect(await markdown(page)).toContain('/');
});

test('the dialog names the provider a URL resolves to, and refuses one no provider claims (24c)', async ({
  page,
}) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await expect(dialog(page)).toBeVisible();

  const submit = dialog(page).getByRole('button', { name: '挿入する' });
  const field = dialog(page).getByLabel('埋め込みたいページの URL');
  await expect(submit).toBeDisabled();

  await field.fill(YOUTUBE);
  await expect(dialog(page)).toContainText('YouTube として埋め込みます。');
  await expect(submit).toBeEnabled();
  // The row for the provider that answered says so, and only that row.
  await expect(dialog(page).getByText('これになります')).toHaveCount(1);

  await field.fill(UNCLAIMED);
  await expect(dialog(page)).toContainText('対応するサービスがありません');
  await expect(submit).toBeDisabled();
  await expect(dialog(page).getByText('これになります')).toHaveCount(0);
});

// The table is the only place an author is told what can be embedded, and it is generated from the
// resolver's registry — `lib/embed-provider.test.ts` holds the list itself to the registry, so what
// is worth measuring here is that the dialog draws all of it.
test('the dialog lists every provider that can be embedded (24d)', async ({ page }) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await expect(dialog(page)).toBeVisible();
  for (const name of [
    'YouTube',
    'X',
    'SlideShare',
    'Figma',
    'Speaker Deck',
    'Docswell',
    'GitHub Gist',
    'CodeSandbox',
    'CodePen',
  ]) {
    await expect(dialog(page).getByText(name, { exact: true }), name).toBeVisible();
  }
  await expect(dialog(page)).toContainText('対応 9 件');
});

// **Inserted into the middle of a document, not an empty one.** The author types in a dialog
// outside the editor, so what is under test is that ProseMirror's selection survives the DOM focus
// leaving — and in an empty document the embed lands in the only place there is, which would pass
// either way.
test('the dialog inserts at the line the menu was opened on (24e)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '前の段落\n\nここに入る\n\n後の段落\n');

  // Put the caret at the end of 「ここに入る」, then open a line under it. **Set, not clicked**: a
  // click resolves the locator and then clicks coordinates, and the editor is still settling after
  // `loadMarkdown` — instrumented 2026-09-02, the caret landed in the *third* paragraph about one
  // run in three, which sent the embed to the end of the document and read as a bug in the insert.
  const end = await page.evaluate((text: string) => {
    const el = document.querySelector('.ProseMirror') as (Element & { editor?: Editor }) | null;
    const editor = el?.editor;
    if (!editor) throw new Error('no live editor on .ProseMirror');
    let found: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found !== null) return false;
      if (node.isTextblock && node.textContent === text) found = pos + node.nodeSize - 1;
      return true;
    });
    if (found === null) throw new Error(`no paragraph reading ${text}`);
    return found;
  }, 'ここに入る');
  await setRange(page, end);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();

  await dialog(page).getByLabel('埋め込みたいページの URL').fill(CODEPEN);
  await dialog(page).getByRole('button', { name: '挿入する' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await settle(page);

  const body = await markdown(page);
  expect(body).toContain(CODEPEN);
  // Between the two paragraphs it was opened between, and above the last one.
  expect(body.indexOf('ここに入る')).toBeLessThan(body.indexOf(CODEPEN));
  expect(body.indexOf(CODEPEN)).toBeLessThan(body.indexOf('後の段落'));
  await expect(page.locator('.ProseMirror .embed-view')).toHaveCount(1);
});

test('Escape and the backdrop close the dialog without inserting (24f)', async ({ page }) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await dialog(page).getByLabel('埋め込みたいページの URL').fill(YOUTUBE);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(await markdown(page)).not.toContain(YOUTUBE);

  // And the field does not remember the abandoned URL the next time it opens — the dialog is the
  // whole of the half-made state here, unlike the card, which leaves an unfinished block behind.
  await page.keyboard.type('/embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await expect(dialog(page).getByLabel('埋め込みたいページの URL')).toHaveValue('');
  await page.locator('div[role="dialog"]').press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});

// §24.1's shape rule. The dialog was a bottom sheet first, and with nine provider rows that came to
// 478px of a 700px screen — it sat in the bottom 68% with the editor's own form fields showing
// above it (reported 2026-09-02), and with a soft keyboard up it would not have fitted at all.
//
// Both viewports in one test on purpose: "it fills the screen" alone would also pass if the
// desktop dialog had become a full-height slab, which is the other way to get this wrong.
test.describe('the dialog is a full screen on a phone and a card on a desktop (24g)', () => {
  const openDialog = async (page: Page) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('/embed');
    await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    return page.getByRole('dialog').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const host = el.parentElement?.getBoundingClientRect();
      return {
        height: Math.round(box.height),
        // The backdrop rather than `innerHeight`: a headless window counts its scrollbar in the
        // latter, and what the dialog is measured against is the fixed layer it sits in.
        available: Math.round(host?.height ?? 0),
        width: Math.round(box.width),
        outerWidth: Math.round(host?.width ?? 0),
      };
    });
  };

  test.describe('narrow', () => {
    test.use({ viewport: { width: 390, height: 700 } });
    test('fills it', async ({ page }) => {
      const box = await openDialog(page);
      expect(box.height).toBe(box.available);
      expect(box.width).toBe(box.outerWidth);
    });
  });

  test.describe('wide', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test('does not', async ({ page }) => {
      const box = await openDialog(page);
      expect(box.height).toBeLessThan(box.available);
      expect(box.width).toBeLessThan(box.outerWidth);
    });
  });
});
