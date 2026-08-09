import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { STORAGE_STATE } from './constants';

// The published footnote preview (docs/footnote-popover-requirements.md §8). Every criterion in
// that list is a decision made somewhere in §3-§6, so this file is arranged the way the decisions
// are: what the pointer does, where the box goes, what the keyboard does, and what touch does.
//
// The post is published once for the whole file. Publishing is the slow part and none of these
// tests write to the document — they read a page that is already public.
//
// §8 recorded the touch criteria (5, 6, 22) as 未確認, with CDP named as the fallback. They are
// measured here: a probe confirmed `page.touchscreen.tap()` under `hasTouch` reaches the page as
// `pointerdown` with `pointerType === 'touch'`, which is the only thing the tap path keys on.

// Long enough to be clipped: the budget is ~31 full-width characters per line at the popover's
// 480px, so eight lines is ~248 and this is ~400. It opens with a link, inline code and bold
// because criterion 14 is about those surviving inside `-webkit-box`, and only what is left
// visible after the clamp can say so.
const LONG_NOTE = `**強調**と[リンク](https://example.com/)と\`code\`で始まる長い注釈。${'この注釈は八行の上限を超えるだけの長さを持っている。'.repeat(14)}`;
const FILLER = `${'本文の埋め草。'.repeat(24)}\n\n`;

const SOURCE = [
  `段落一[^rich]。参照の位置を測るための本文である。\n\n`,
  FILLER,
  `段落二[^long]。ここで八行の上限を測る。\n\n`,
  FILLER,
  `[^edge]。行頭の参照で画面端の寄せを測る。\n\n`,
  `[^rich]: 注釈に[リンク](https://example.com/)と\`code\`と**強調**が入る。\n`,
  `[^long]: ${LONG_NOTE}\n`,
  `[^edge]: 画面端の参照のための注釈。\n`,
].join('');

let postHref = '';

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('Footnote popover spec');
  await loadMarkdown(page, SOURCE);
  await expect(page.locator('.ProseMirror div[data-footnote-def]')).toHaveCount(3);
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });
  const href = await page.getByRole('link', { name: '表示' }).getAttribute('href');
  expect(href).toMatch(/^\/posts\/[0-9a-f]+$/);
  postHref = href!;
  await context.close();
});

// The enhancer marks each reference it has taken on, so a test never races the effect. It is also
// the observable half of §3.6: a reference with no definition on the page is left unmarked.
async function openPost(page: Page): Promise<void> {
  await page.goto(postHref);
  await page.waitForFunction(
    () => document.querySelectorAll('a[data-footnote-ref][data-footnote-popover]').length === 3,
  );
}

function refs(page: Page) {
  return page.locator('#post-body a[data-footnote-ref]');
}

type Rect = { top: number; bottom: number; left: number; right: number; width: number };

async function rects(page: Page, selector: string, index = 0): Promise<Rect> {
  return page
    .locator(selector)
    .nth(index)
    .evaluate((el) => {
      const { top, bottom, left, right, width } = el.getBoundingClientRect();
      return { top, bottom, left, right, width };
    });
}

test('hover previews the note, and the plain click it is added to is untouched', async ({
  page,
}) => {
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  const rich = refs(page).first();

  await rich.hover();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('注釈に');

  // The content is the definition's own HTML, minus the one part that means nothing in here: `↩`
  // points back to where the reader is already standing (§4.1).
  await expect(preview.locator('a[data-footnote-backref]')).toHaveCount(0);
  await expect(
    preview.locator('.footnote-popover-note a[href="https://example.com/"]'),
  ).toHaveCount(1);
  await expect(preview.locator('.footnote-popover-note code')).toHaveCount(1);
  await expect(preview.locator('.footnote-popover-note strong')).toHaveCount(1);

  // Reachable, so hidden from nobody: the preview can be entered and its links used (§4.1.1), and
  // `aria-hidden` or `inert` over usable controls is the pairing §3.5.1 rules out.
  await expect(preview).not.toHaveAttribute('aria-hidden', 'true');
  await expect(preview).not.toHaveAttribute('inert', '');
  await expect(preview).not.toHaveCSS('pointer-events', 'none');

  // No internal scrolling (§4.3.1). The `[popover]` UA rule is `overflow: auto`, so this is a real
  // thing to hold down rather than a property that comes for free. Measured in the ordinary case;
  // §5.2.2's last-resort height cap is a different branch, and criterion 25 is what covers it.
  const scrolls = await preview.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(false);

  // Above the reference and clear of it (§5.2, §5.3) — the reader is about to click that anchor.
  const box = await rects(page, '.footnote-popover--preview');
  const ref = await rects(page, '#post-body a[data-footnote-ref]');
  expect(box.bottom).toBeLessThan(ref.top);
  // Centred on it, with room to spare on both sides at this width (§5.2.1's clamp does not bite).
  expect((box.left + box.right) / 2).toBeCloseTo((ref.left + ref.right) / 2, 0);

  // The look itself is not assertable, so it is written out the way the definition-layout spec
  // writes its markers: something to open when the question is "what does this actually look like".
  await page.screenshot({
    path: 'e2e/.tmp/public-footnote-popover.png',
    clip: { x: 0, y: Math.max(box.top - 24, 0), width: 1280, height: ref.bottom - box.top + 48 },
  });

  await page.mouse.move(0, 0);
  await expect(preview).toBeHidden();

  // The property this whole design is built around (§3.1): the reference is still an anchor, and
  // hovering it first — the way a reader actually arrives at the click — changes nothing. With
  // `pointer-events: none` gone (§4.1.1), the only thing keeping the box out of that click's way is
  // where it is put, which is why this and criterion 16 above are now one pair.
  await rich.hover();
  await expect(preview).toBeVisible();
  await rich.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#user-content-fn-rich');
});

test('the pointer can travel into the preview and use the note’s link', async ({ page }) => {
  // WCAG SC 1.4.13 Hoverable, and the reason the close delay exists (§6.1). The reference and the
  // box are separated by a gap that keeps the box off the click (§5.3), so the pointer is briefly
  // over neither — an immediate close would make the preview unreachable in principle.
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  await refs(page).first().hover();
  await expect(preview).toBeVisible();

  const box = await rects(page, '.footnote-popover--preview');
  const link = preview.locator('.footnote-popover-note a[href="https://example.com/"]');
  const linkBox = await link.boundingBox();

  // Cross the gap the way a hand does — through the dead zone, not by teleporting inside.
  await page.mouse.move((box.left + box.right) / 2, box.bottom + 4);
  await page.mouse.move(linkBox!.x + linkBox!.width / 2, linkBox!.y + linkBox!.height / 2);
  // Longer than the close delay: a preview that merely closes late would pass a shorter wait.
  await page.waitForTimeout(600);
  await expect(preview).toBeVisible();

  // Reachable, not just visible: the link under the pointer is what a click would land on.
  const hit = await link.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  expect(hit).toBe(true);

  // And it still closes once the pointer leaves for good — the delay is a bridge, not a latch.
  await page.mouse.move(0, 0);
  await expect(preview).toBeHidden();
});

test('a modifier click is left for the browser', async ({ page }) => {
  await openPost(page);
  // Read `defaultPrevented` from a document listener, which runs after the enhancer's own — then
  // cancel it here so Chrome does not open the background tab the modifier asks for. A real
  // ctrl+click rather than a synthetic event: the enhancer keys on the pointerdown that precedes
  // it, and a dispatched click has none.
  type ProbeWindow = Window & { __footnoteClickPrevented?: boolean };
  await page.evaluate(() => {
    document.addEventListener(
      'click',
      (event) => {
        (window as ProbeWindow).__footnoteClickPrevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
  });
  await refs(page)
    .first()
    .click({ modifiers: ['ControlOrMeta'] });
  const prevented = await page.evaluate(() => (window as ProbeWindow).__footnoteClickPrevented);
  expect(prevented).toBe(false);
});

test('a long note is clipped to eight lines with its elements intact', async ({ page }) => {
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  await refs(page).nth(1).hover();
  await expect(preview).toBeVisible();

  const note = preview.locator('.footnote-popover-note');
  const clamp = await note.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      lines: style.webkitLineClamp,
      lineHeight: parseFloat(style.lineHeight),
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    };
  });
  expect(clamp.lines).toBe('8');
  // Clipped, not merely long: `-webkit-line-clamp` leaves the rest in the box and hides it, which
  // is also what puts the `…` on the last visible line.
  expect(clamp.scrollHeight).toBeGreaterThan(clamp.clientHeight);
  expect(clamp.clientHeight).toBeCloseTo(clamp.lineHeight * 8, 0);

  // The mechanism could have flattened these — that is the reason §4.3.2 measured it before
  // choosing, and the reason it is measured again here on the clipped note rather than only on the
  // short one above.
  await expect(note.locator('a[href="https://example.com/"]')).toHaveCount(1);
  await expect(note.locator('code')).toHaveCount(1);
  await expect(note.locator('strong')).toHaveCount(1);
});

test('the preview flips below a reference near the top of the viewport', async ({ page }) => {
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  // Put the reference ~40px down the viewport: nothing the popover's height could fit above.
  await refs(page)
    .nth(1)
    .evaluate((el) => {
      window.scrollBy(0, el.getBoundingClientRect().top - 40);
    });
  await refs(page).nth(1).hover();
  await expect(preview).toBeVisible();

  const box = await rects(page, '.footnote-popover--preview');
  const ref = await rects(page, '#post-body a[data-footnote-ref]', 1);
  expect(box.top).toBeGreaterThan(ref.bottom);
});

test('a narrow viewport clamps the box inside the screen instead of centring it', async ({
  page,
}) => {
  // Where centring and staying on screen cannot both hold (§5.2.1). On a phone the width is
  // `100vw - 2rem`, so the clamp wins for almost every reference — the box is nearly the screen.
  await page.setViewportSize({ width: 400, height: 900 });
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  await refs(page).nth(2).hover(); // the line-leading reference: its centre is far left
  await expect(preview).toBeVisible();

  const box = await rects(page, '.footnote-popover--preview');
  expect(box.left).toBeGreaterThanOrEqual(16 - 0.5); // the 1rem margin §5.2.1 names
  expect(box.right).toBeLessThanOrEqual(400 - 16 + 0.5);
});

test('a short viewport drops the line count rather than capping the height', async ({ page }) => {
  // Landscape-phone shaped. §4.3.2 forbids mixing a height cap with the clamp — a box cut by
  // `max-height` shows no `…` — so the media query shortens the note first (§5.2.2's ordering).
  await page.setViewportSize({ width: 800, height: 380 });
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  await refs(page).nth(1).hover();
  await expect(preview).toBeVisible();

  await expect(preview.locator('.footnote-popover-note')).toHaveCSS('-webkit-line-clamp', '4');
  const box = await rects(page, '.footnote-popover--preview');
  expect(box.top).toBeGreaterThanOrEqual(-0.5);
  expect(box.bottom).toBeLessThanOrEqual(380 + 0.5);
  // The clamp did the work on its own here: no height cap was needed, which is the ordering
  // §5.2.2 asks for.
  expect(await preview.evaluate((el) => el.style.maxHeight)).toBe('');
});

test('with room on neither side the height is capped as a last resort', async ({ page }) => {
  // §5.2.2's third branch, which the ordering above is meant to reach only when it has to: shorter
  // than the shortened note plus its margins on either side of the reference. Measured separately
  // because the branch that never runs is the one nobody notices is wrong.
  await page.setViewportSize({ width: 800, height: 240 });
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  await refs(page).nth(1).hover();
  await expect(preview).toBeVisible();

  expect(await preview.evaluate((el) => el.style.maxHeight)).not.toBe('');
  const box = await rects(page, '.footnote-popover--preview');
  expect(box.top).toBeGreaterThanOrEqual(-0.5);
  expect(box.bottom).toBeLessThanOrEqual(240 + 0.5);
});

test('the keyboard previews on focus, dismisses on Escape and still jumps on Enter', async ({
  page,
}) => {
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  const rich = refs(page).first();

  // A real Tab, not `.focus()`: the enhancer asks `:focus-visible`, which is exactly the state a
  // scripted focus is allowed not to enter (a click focuses the anchor too, and that path jumps).
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Tab');
        return rich.evaluate((el) => el === document.activeElement);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(preview).toBeVisible();

  // WCAG SC 1.4.13: content shown on focus has to be dismissable without moving focus — and a
  // `manual` popover gets no Escape from the platform, so this is the enhancer's own listener.
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  expect(await rich.evaluate((el) => el === document.activeElement)).toBe(true);

  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#user-content-fn-rich');
});

test('a reference whose definition is missing keeps its plain anchor', async ({ page }) => {
  // §3.6. The editor cannot publish this shape — it refuses a post with an incomplete footnote —
  // so the definition's `id` is renamed in flight instead, in both the HTML and the RSC payload
  // that carries the same markup. The reference's `href` is left pointing where it pointed.
  // Renamed in the DOM as it is parsed rather than in the response body: the markup arrives twice
  // (the served HTML, and the RSC payload React hydrates from), and an observer catches the
  // definition the moment it exists — well before the effect that would enhance its reference.
  await page.addInitScript(() => {
    const rename = (root: ParentNode): boolean => {
      const definition = root.querySelector('#user-content-fn-rich');
      if (!definition) return false;
      definition.id = 'user-content-fn-gone';
      return true;
    };
    const observer = new MutationObserver(() => {
      if (rename(document)) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto(postHref);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelectorAll('a[data-footnote-ref][data-footnote-popover]').length,
      ),
    )
    .toBe(2);
  expect(await page.locator('#user-content-fn-rich').count()).toBe(0); // the rename really landed

  const rich = refs(page).first();
  await expect(rich).not.toHaveAttribute('data-footnote-popover', 'on');
  await rich.hover();
  await expect(page.locator('.footnote-popover--preview')).toBeHidden();
  // Still an anchor, doing what an anchor does — which is the whole reason nothing here rewrites
  // `href` or `id` (§3.4).
  await rich.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#user-content-fn-rich');
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('a tap pins the note, and its 定義へ is the jump the click keeps on desktop', async ({
    page,
  }) => {
    await openPost(page);
    const pinned = page.locator('.footnote-popover--pinned');
    const ref = refs(page).first();

    const box = await ref.boundingBox();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(pinned).toBeVisible();
    // The tap did NOT jump: this is the one place the design intervenes, and it is the only place
    // a modifier click cannot exist (§3.3).
    expect(await page.evaluate(() => location.hash)).toBe('');

    // It holds a link, so it is not hidden from assistive technology the way the preview is — a
    // focusable element inside `aria-hidden` is present to Tab and absent to a screen reader.
    await expect(pinned).not.toHaveAttribute('aria-hidden', 'true');
    await expect(pinned).not.toHaveAttribute('inert', '');

    const jump = pinned.locator('.footnote-popover-jump');
    await expect(jump).toHaveText('定義へ');
    await expect(jump).toHaveAttribute('href', '#user-content-fn-rich');

    // Scroll and resize move it; neither closes it (§5.2.3 — the close conditions are §6's alone).
    //
    // Measured as the gap to whichever side it is on, not as a signed offset: scrolling changes how
    // much room is left above, so the box is allowed to flip below on the way (§5.2). "Still
    // attached to its reference" is the claim criterion 20 makes, and a side-specific number would
    // fail a correct flip.
    const gap = async () => {
      const p = await rects(page, '.footnote-popover--pinned');
      const r = await rects(page, '#post-body a[data-footnote-ref]');
      return Math.round(Math.min(Math.abs(r.top - p.bottom), Math.abs(p.top - r.bottom)));
    };
    const resting = await gap();
    expect(resting).toBe(8);
    await page.evaluate(() => window.scrollBy(0, 120));
    await expect(pinned).toBeVisible();
    await expect.poll(gap).toBe(resting);
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(pinned).toBeVisible();
    await expect.poll(gap).toBe(resting);

    // Touch has no click to fall back on, so this link is the only way to the rest of a clipped
    // note (§4.3.1) — and following it closes the box rather than leaving it over the destination.
    await jump.tap();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#user-content-fn-rich');
    await expect(pinned).toBeHidden();
  });

  test('a tap outside dismisses the pinned note', async ({ page }) => {
    await openPost(page);
    const pinned = page.locator('.footnote-popover--pinned');
    const box = await refs(page).first().boundingBox();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(pinned).toBeVisible();

    // Light dismiss, which is what `popover="auto"` was chosen for (§5.1.1).
    await page.touchscreen.tap(5, 5);
    await expect(pinned).toBeHidden();
  });
});

test.describe('the dark scheme', () => {
  test.use({ colorScheme: 'dark' });

  test('draws the popover in the same shades as the rest of the page', async ({ page }) => {
    await openPost(page);
    const preview = page.locator('.footnote-popover--preview');
    await refs(page).first().hover();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS('background-color', 'rgb(22, 27, 34)'); // #161b22
    await expect(preview).toHaveCSS('border-top-color', 'rgb(48, 54, 61)'); // #30363d
  });
});

test('without JavaScript the reference is still a working anchor', async ({ browser }) => {
  // Progressive enhancement (§3.4), and it is free rather than built: the markup is untouched, so
  // the page that never runs the enhancer is the page as it was before this feature.
  const context = await browser.newContext({
    storageState: STORAGE_STATE,
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto(postHref);
  await expect(page.locator('#post-body a[data-footnote-ref]').first()).toBeVisible();
  expect(await page.locator('.footnote-popover').count()).toBe(0);

  await page.locator('#post-body a[data-footnote-ref]').first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#user-content-fn-rich');
  await context.close();
});
