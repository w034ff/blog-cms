import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { markdown, docString } from './editor-probe';
import { gotoPublished } from './published-post';

// The accordion's editor chrome (docs/accordion-requirements.md §5.1, §7.3, §8.2): the toggle's
// label, the untitled placeholder, and folding as a view action that must not dirty the post.

const DETAILS = '.ProseMirror [data-type="details"]';

test('the toggle carries a Japanese label and folds without touching the document', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await loadMarkdown(page, '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n');
  const toggle = page.locator(`${DETAILS} > button`);
  const body = page.locator(`${DETAILS} [data-type="detailsContent"]`);

  // Closed at first, as published.
  await expect(toggle).toHaveAttribute('aria-label', 'アコーディオンを開く');
  await expect(body).toBeHidden();

  const before = await markdown(page);
  const docBefore = await docString(page);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'アコーディオンを閉じる');
  await expect(body).toBeVisible();

  // The open state is the NodeView's: same doc and markdown, nothing dirty.
  expect(await docString(page)).toBe(docBefore);
  expect(await markdown(page)).toBe(before);

  await toggle.click();
  await expect(body).toBeHidden();
  expect(await markdown(page)).toBe(before);
});

// A ::before, unreachable through toHaveCSS.
function summaryMarker(page: Page): Promise<string> {
  return page.evaluate(() => {
    const summary = document.querySelector('.ProseMirror summary');
    if (!summary) throw new Error('no summary in the editor');
    return getComputedStyle(summary, '::before').content;
  });
}

// The caret's drawn distance from the title's text start: an inline ::before takes width and pushes
// the caret past it while its offset stays 0, so pixels are the whole defect.
function caretOffsetFromTextStart(page: Page): Promise<number> {
  return page.evaluate(() => {
    const dom = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            state: { selection: { from: number } };
            view: { coordsAtPos(pos: number): { left: number } };
          };
        })
      | null;
    const summary = document.querySelector('.ProseMirror summary');
    if (!dom?.editor || !summary) throw new Error('no accordion in the editor');
    const { state, view } = dom.editor;
    const caret = view.coordsAtPos(state.selection.from);
    const box = summary.getBoundingClientRect();
    const textStart = box.left + parseFloat(getComputedStyle(summary).paddingLeft);
    return Math.round((caret.left - textStart) * 10) / 10;
  });
}

test('an untitled accordion shows a placeholder but still saves', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::details ');
  expect(await summaryMarker(page)).toContain('タイトル');
  // Where the first character will go, within a pixel.
  expect(await caretOffsetFromTextStart(page)).toBeCloseTo(0, 0);

  // §5.1: an empty title saves, so the markdown must still be produced.
  expect(await markdown(page)).toBe('<details>\n<summary></summary>\n\n</details>');

  await page.keyboard.type('題名');
  expect(await summaryMarker(page)).not.toContain('タイトル');
});

// The marker is placed by arithmetic over the title row's own padding and line box (app/globals.css),
// so it does not shrink with a collapsing row. `markerBelowRow` is only a sign: the button is read
// against the border box, the ::before against the padding box. `rowHeight` is compared across
// shapes.
function titleRowGeometry(page: Page, cardSelector: string) {
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector)).map((card) => {
      const summary = card.querySelector('summary');
      if (!summary) throw new Error('no summary in the card');
      const cardBox = card.getBoundingClientRect();
      const rowBox = summary.getBoundingClientRect();
      // A <button> in the editor; the page's ::before only through computed style.
      const button = card.querySelector('button');
      const marker = button
        ? { top: button.getBoundingClientRect().top - cardBox.top, height: button.offsetHeight }
        : {
            top: parseFloat(getComputedStyle(summary, '::before').top),
            height: parseFloat(getComputedStyle(summary, '::before').height),
          };
      return {
        rowHeight: Math.round(rowBox.height),
        // Positive: the marker hangs below its row.
        markerBelowRow: Math.round(marker.top + marker.height - (rowBox.bottom - cardBox.top)),
      };
    });
  }, cardSelector);
}

// §5.1: a published `<summary></summary>` has no line box and collapses to its padding, while the
// editor's keeps a trailing <br>. Compared with a titled row: matching is the requirement (§8.2).
test('an untitled accordion keeps its title row in both DOM shapes', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('accordion-untitled-layout');
  await loadMarkdown(
    page,
    '<details>\n<summary></summary>\n\n無題の本文\n\n</details>\n\n' +
      '<details>\n<summary>題あり</summary>\n\n本文\n\n</details>\n',
  );

  const inEditor = await titleRowGeometry(page, '.ProseMirror [data-type="details"]');
  expect(inEditor).toHaveLength(2);
  expect(inEditor[0].rowHeight).toBe(inEditor[1].rowHeight);
  expect(inEditor[0].markerBelowRow).toBeLessThanOrEqual(0);

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const published = page.locator('article details');
  await expect(published).toHaveCount(2);

  for (const open of [false, true]) {
    if (open) {
      await published.first().locator('summary').click();
      await expect(page.getByText('無題の本文')).toBeVisible();
    }
    const onPage = await titleRowGeometry(page, 'article details');
    expect(onPage[0].rowHeight).toBe(onPage[1].rowHeight);
    expect(onPage[0].markerBelowRow).toBeLessThanOrEqual(0);
    // The row the author saw.
    expect(onPage[0].rowHeight).toBe(inEditor[0].rowHeight);
  }
});

test('the published page folds and unfolds', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('accordion-public');
  await loadMarkdown(page, '<details>\n<summary>詳細</summary>\n\n畳まれた本文\n\n</details>\n');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  await gotoPublished(page);

  const details = page.locator('article details');
  await expect(details).toHaveCount(1);
  await expect(page.getByText('畳まれた本文')).toBeHidden();

  await details.getByText('詳細').click();
  await expect(page.getByText('畳まれた本文')).toBeVisible();
});
