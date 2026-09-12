import { test, expect, type Locator, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { gotoPublished } from './published-post';

// Neither of the two footnote links carries a resting underline any more, so hover and keyboard
// focus are the entire affordance and both have to be measured — a resting underline is what would
// normally cover for one of them being wrong. Written once and run against each link, because
// "the backref matches the reference" is the claim, and running the same steps is what states it.
async function underlinesOnPointerAndKeyboard(page: Page, link: Locator): Promise<void> {
  await expect(link).toHaveCSS('text-decoration-line', 'none');
  await link.hover();
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
  await page.mouse.move(0, 0);
  await expect(link).toHaveCSS('text-decoration-line', 'none');

  // A real Tab, not `.focus()`: `:focus-visible` is only meant to match when the browser judges the
  // focus worth showing, and a scripted focus is exactly the case it is allowed to skip.
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

// The published page had no rule of its own for a footnote reference, so it fell through to
// @tailwindcss/typography's plain link styling — a near-black underlined `1` — while the editor drew
// a blue `[1]` for the same thing. That is now unified, and it is CSS-only: the brackets are
// pseudo-content, so nothing about it reaches vitest.
//
// The definitions are the deliberate other half — they stay prose's `1.` (§4.2) — and this test
// pins that too, so the divergence reads as a decision rather than as something nobody noticed.
//
// Eleven notes, matching the editor's definition-layout spec: 9→10 is where a bracketed marker changes
// width, which is where an assumption about either surface's numbering tends to show.
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

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });

  await gotoPublished(page);

  // remark-gfm puts the attribute on the <a>, inside a bare <sup> — the shape the CSS selectors
  // depend on, and the thing rehype-sanitize could have taken away.
  const refs = page.locator('.prose sup > a[data-footnote-ref]');
  await expect(refs).toHaveCount(COUNT);

  // The brackets are drawn on the <a> so they join its click target, and the number itself stays
  // real text — a copied selection yields `1`, which is what the Markdown says.
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
  // At rest prose's own `a` underline is held back — at 0.75em it sits almost on the digits.
  expect(brackets.decoration).toBe('none');
  await underlinesOnPointerAndKeyboard(page, first);

  // The `↩` backref gets the reference's treatment because it is the return leg of the reference's
  // jump — same colour, same hover-only underline. It sits inside the definitions, which are
  // otherwise left alone (below), so it is checked here, beside the link it matches.
  const back = page.locator('.prose a[data-footnote-backref]').first();
  await expect(back).toHaveCSS('color', 'rgb(9, 105, 218)');
  await underlinesOnPointerAndKeyboard(page, back);

  // Drawn smaller than the note it closes, but not hit smaller: the padding exists to hold the
  // click target while the glyph recedes, and shrinking a target is the kind of thing a font-size
  // change does silently. Measured against the note's own line, which is the target a reader
  // already expects to be able to hit.
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

  // The definitions are the half that is deliberately NOT unified (§4.2): this side keeps prose's
  // own `1.` and prose's own indent, where the editor draws `[1]` in a measured 2.6em box. Pinned
  // rather than left implicit, because "the two surfaces don't match" is exactly the observation
  // that would send someone to change it back — both were built and taken out again.
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
