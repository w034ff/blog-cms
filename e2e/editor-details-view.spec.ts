import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown } from './editor-authoring';
import { markdown, docString } from './editor-probe';
import { gotoPublished } from './published-post';

// The accordion's editor chrome (docs/accordion-requirements.md §5.1, §7.3, §8.2): the toggle's
// Japanese label, the untitled placeholder, and the rule that folding is a view action — it must
// not touch the document, or every collapse would mark the post dirty and fire autosave.

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

  // Closed to begin with, as the public page renders it.
  await expect(toggle).toHaveAttribute('aria-label', 'アコーディオンを開く');
  await expect(body).toBeHidden();

  const before = await markdown(page);
  const docBefore = await docString(page);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'アコーディオンを閉じる');
  await expect(body).toBeVisible();

  // The open state lives in the NodeView, not in the document: same doc, same markdown, so
  // nothing marks the post dirty.
  expect(await docString(page)).toBe(docBefore);
  expect(await markdown(page)).toBe(before);

  await toggle.click();
  await expect(body).toBeHidden();
  expect(await markdown(page)).toBe(before);
});

// The placeholder is a ::before, which is not reachable through toHaveCSS — that reports the
// element's own computed style.
function summaryMarker(page: Page): Promise<string> {
  return page.evaluate(() => {
    const summary = document.querySelector('.ProseMirror summary');
    if (!summary) throw new Error('no summary in the editor');
    return getComputedStyle(summary, '::before').content;
  });
}

// How far the caret is drawn from where the title's own text begins. Generated content is laid out
// inline by default, so a placeholder written as a plain ::before takes real width on the line and
// pushes the caret past itself — 52.5px, the width of 「タイトル」 — even though the caret is at
// offset 0. Measured in pixels because that is the whole of the defect: the document position was
// right the entire time.
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
  // The caret sits where the first character will go, not after the placeholder. Within a pixel,
  // since both sides are sub-pixel layout measurements; the defect this guards was 52.5px.
  expect(await caretOffsetFromTextStart(page)).toBeCloseTo(0, 0);

  // §5.1: an empty title is allowed through save and publish — the placeholder is the whole of
  // the safeguard, so the markdown must still be produced.
  expect(await markdown(page)).toBe('<details>\n<summary></summary>\n\n</details>');

  await page.keyboard.type('題名');
  expect(await summaryMarker(page)).not.toContain('タイトル');
});

// The marker is placed by arithmetic over the title row's own padding and line box (app/globals.css),
// not by the flow, so it cannot shrink along with a row that collapses.
//
// `markerBelowRow` is a within-shape sign check, NOT a number to compare across the two: the two
// branches below measure from different origins. The editor's button is read with
// getBoundingClientRect, i.e. against the card's *border* box; the public marker's `top` comes from
// the computed style of an absolutely positioned ::before, which resolves against the card's
// *padding* box. The 1px border between them makes the public figure one too small (measured with
// a titled accordion: editor -9, public -15 where the true value is -14). That is why only
// `rowHeight` — a plain height, same meaning in both — is asserted across the shapes, and
// `markerBelowRow` is only ever asserted against 0, which it clears by 9px or more.
function titleRowGeometry(page: Page, cardSelector: string) {
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector)).map((card) => {
      const summary = card.querySelector('summary');
      if (!summary) throw new Error('no summary in the card');
      const cardBox = card.getBoundingClientRect();
      const rowBox = summary.getBoundingClientRect();
      // The editor's marker is a real <button>; the public page's is the summary's ::before, whose
      // box is only reachable through the computed style.
      const button = card.querySelector('button');
      const marker = button
        ? { top: button.getBoundingClientRect().top - cardBox.top, height: button.offsetHeight }
        : {
            top: parseFloat(getComputedStyle(summary, '::before').top),
            height: parseFloat(getComputedStyle(summary, '::before').height),
          };
      return {
        rowHeight: Math.round(rowBox.height),
        // Positive means the marker hangs below the row it belongs to — onto the body, once open.
        markerBelowRow: Math.round(marker.top + marker.height - (rowBox.bottom - cardBox.top)),
      };
    });
  }, cardSelector);
}

// §5.1 lets an untitled accordion save and publish, so the published page has to lay one out. It
// is the only place that can go wrong: `<summary></summary>` has no inline content and so makes no
// line box, collapsing the row to its padding, while the editor's summary always holds
// ProseMirror's trailing <br> and keeps its height. The row is asserted against a titled one in
// the same document rather than a fixed pixel count — matching is the actual requirement (§8.2),
// and a number here would have to be re-derived every time the padding changes.
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
    // …and the same row the author saw while writing it.
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
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  await gotoPublished(page);

  const details = page.locator('article details');
  await expect(details).toHaveCount(1);
  await expect(page.getByText('畳まれた本文')).toBeHidden();

  await details.getByText('詳細').click();
  await expect(page.getByText('畳まれた本文')).toBeVisible();
});
