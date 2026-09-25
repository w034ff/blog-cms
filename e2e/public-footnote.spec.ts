import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { gotoPublished } from './published-post';

// No resting underline on either footnote link, so hover and keyboard focus are the affordance and
// both are measured, the same steps for each: the backref matching the reference is the claim.
async function underlinesOnPointerAndKeyboard(page: Page, link: Locator): Promise<void> {
  await expect(link).toHaveCSS('text-decoration-line', 'none');
  await link.hover();
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
  await page.mouse.move(0, 0);
  await expect(link).toHaveCSS('text-decoration-line', 'none');

  // A real Tab: `:focus-visible` may skip scripted focus.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Tab');
        return link.evaluate((el) => el === document.activeElement);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
}

// The published reference fell through to Typography (a near-black underlined `1`); it now matches
// the editor's blue `[1]`, in CSS only. The definitions deliberately stay prose's `1.` (§4.2),
// pinned too. Eleven notes: 9→10 changes a marker's width.
const COUNT = 11;

const SOURCE = `${Array.from({ length: COUNT }, (_, i) => `文${i + 1}[^n${i + 1}]`).join('')}\n\n${Array.from(
  { length: COUNT },
  (_, i) => `[^n${i + 1}]: 注釈テキスト${i + 1}`,
).join('\n')}\n`;

test('a published footnote reference is the editor’s `[n]`, and its definition is not', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('Public footnote spec');
  await loadMarkdown(page, SOURCE);
  await expect(page.locator('.ProseMirror div[data-footnote-def]')).toHaveCount(COUNT);

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  await gotoPublished(page);

  // remark-gfm's attribute on the <a> in a bare <sup>: what the selectors need and sanitize could
  // remove.
  const refs = page.locator('.prose sup > a[data-footnote-ref]');
  await expect(refs).toHaveCount(COUNT);

  // Brackets on the <a> join its target; the number stays text, so a copy yields `1`.
  const first = refs.first();
  await expect(first).toHaveText('1');
  const brackets = await first.evaluate((el) => ({
    before: getComputedStyle(el, '::before').content,
    after: getComputedStyle(el, '::after').content,
    color: getComputedStyle(el).color,
    decoration: getComputedStyle(el).textDecorationLine,
  }));
  expect(brackets.before).toBe('"["');
  expect(brackets.after).toBe('"]"');
  expect(brackets.color).toBe('rgb(9, 105, 218)'); // #0969da, the editor's reference blue, light theme
  // No underline at rest: at 0.75em it sits on the digits.
  expect(brackets.decoration).toBe('none');
  await underlinesOnPointerAndKeyboard(page, first);

  // The backref, the return leg, matches the reference; checked here beside it.
  const back = page.locator('.prose a[data-footnote-backref]').first();
  await expect(back).toHaveCSS('color', 'rgb(9, 105, 218)');
  await underlinesOnPointerAndKeyboard(page, back);

  // Smaller than the note, but not a smaller target: the padding holds it, measured against the
  // note's line.
  const sized = await back.evaluate((el) => {
    const li = el.closest('li')!;
    return {
      glyph: parseFloat(getComputedStyle(el).fontSize),
      note: parseFloat(getComputedStyle(li).fontSize),
      targetHeight: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(li).lineHeight),
    };
  });
  expect(sized.glyph).toBeLessThan(sized.note);
  expect(sized.targetHeight).toBeGreaterThanOrEqual(sized.note);

  // The definitions stay prose's `1.` and indent (§4.2), pinned: "the surfaces don't match" would
  // prompt a change back, and both versions were built and removed.
  const items = page.locator('.prose section[data-footnotes] > ol > li');
  await expect(items).toHaveCount(COUNT);
  const markers = await items.evaluateAll((lis) =>
    lis.map((li) => getComputedStyle(li, '::marker').content),
  );
  expect(markers.every((c) => !c.includes('['))).toBe(true);

  const listBox = await page.locator('.prose section[data-footnotes] > ol').evaluate((ol) => {
    const s = getComputedStyle(ol);
    return { padding: parseFloat(s.paddingInlineStart), fontSize: parseFloat(s.fontSize) };
  });
  expect(listBox.padding).toBeCloseTo(listBox.fontSize * 1.625, 1); // prose's own `ol` indent

  await page.locator('.prose section[data-footnotes]').screenshot({
    path: 'e2e/.tmp/public-footnote-definitions.png',
  });
});
