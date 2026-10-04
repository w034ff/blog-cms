import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { STORAGE_STATE } from './constants';
import { publishedPath } from './published-post';

// The published footnote preview (docs/footnote-popover-requirements.md §8), arranged as §3-§6
// are: pointer, placement, keyboard, touch. Published once for the file; no test writes. The touch
// criteria (5, 6, 22) are measured: `page.touchscreen.tap()` under `hasTouch` arrives as
// `pointerdown` with `pointerType === 'touch'`, which is all the tap path keys on.

// Clipped: ~31 characters per line at 480px, eight lines ~248, this ~400. It opens with a link,
// code and bold for criterion 14, which only the visible part after the clamp can show.
const LONG_NOTE = `**強調**と[リンク](https://example.com/)と\`code\`で始まる長い注釈。${'この注釈は八行の上限を超えるだけの長さを持っている。'.repeat(14)}`;
const FILLER = `${'本文の埋め草。'.repeat(24)}\n\n`;

const SOURCE = [
  `段落一。参照の位置を測るための本文である[^rich]。\n\n`,
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
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  postHref = await publishedPath(page);
  await context.close();
});

// The enhancer's mark, so no test races the effect; unmarked means no definition (§3.6).
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

  // The definition's HTML minus `↩`, which points where the reader already is (§4.1).
  await expect(preview.locator('a[data-footnote-backref]')).toHaveCount(0);
  await expect(
    preview.locator('.footnote-popover-note a[href="https://example.com/"]'),
  ).toHaveCount(1);
  await expect(preview.locator('.footnote-popover-note code')).toHaveCount(1);
  await expect(preview.locator('.footnote-popover-note strong')).toHaveCount(1);

  // Enterable with usable links (§4.1.1), so not `aria-hidden` or `inert` (§3.5.1).
  await expect(preview).not.toHaveAttribute('aria-hidden', 'true');
  await expect(preview).not.toHaveAttribute('inert', '');
  await expect(preview).not.toHaveCSS('pointer-events', 'none');

  // No internal scrolling (§4.3.1): the `[popover]` UA rule is `overflow: auto`. §5.2.2's height cap is
  // criterion 25's.
  const scrolls = await preview.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(false);

  // Above and clear of the reference (§5.2, §5.3), which the reader is about to click.
  const box = await rects(page, '.footnote-popover--preview');
  const ref = await rects(page, '#post-body a[data-footnote-ref]');
  expect(box.bottom).toBeLessThan(ref.top);
  // Centred on it. The reference sits deep in its line so §5.2.1's clamp does not bite: the body
  // starts at the page box's left edge, and a reference near it pins the box at the margin instead.
  expect((box.left + box.right) / 2).toBeCloseTo((ref.left + ref.right) / 2, 0);

  // The look is not assertable, so a screenshot to open when asking what it looks like.
  await page.screenshot({
    path: 'e2e/.tmp/public-footnote-popover.png',
    clip: { x: 0, y: Math.max(box.top - 24, 0), width: 1280, height: ref.bottom - box.top + 48 },
  });

  await page.mouse.move(0, 0);
  await expect(preview).toBeHidden();

  // §3.1: the reference stays an anchor, and hovering first changes nothing. With `pointer-events:
  // none` gone (§4.1.1), placement alone keeps the box out of the click; paired with criterion 16.
  await rich.hover();
  await expect(preview).toBeVisible();
  await rich.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#user-content-fn-rich');
});

test('the pointer can travel into the preview and use the note’s link', async ({ page }) => {
  // WCAG SC 1.4.13 Hoverable and the close delay (§6.1): the gap keeping the box off the click (§5.3)
  // leaves the pointer over neither, so an immediate close would make the preview unreachable.
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  await refs(page).first().hover();
  await expect(preview).toBeVisible();

  const box = await rects(page, '.footnote-popover--preview');
  const link = preview.locator('.footnote-popover-note a[href="https://example.com/"]');
  const linkBox = await link.boundingBox();

  // Cross the gap as a hand does, through the dead zone.
  await page.mouse.move((box.left + box.right) / 2, box.bottom + 4);
  await page.mouse.move(linkBox!.x + linkBox!.width / 2, linkBox!.y + linkBox!.height / 2);
  // Longer than the close delay, so a merely late close fails.
  await page.waitForTimeout(600);
  await expect(preview).toBeVisible();

  // Reachable: the link is what a click there would hit.
  const hit = await link.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  expect(hit).toBe(true);

  // It still closes once the pointer leaves: a bridge, not a latch.
  await page.mouse.move(0, 0);
  await expect(preview).toBeHidden();
});

test('the open preview takes the pointer away from the body it covers', async ({ page }) => {
  // §4.1.1's fourth cost, unanswered: the box now blocks what it overlays. Pinned as the intended
  // state; it goes red if `pointer-events: none` returns.
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  const long = refs(page).nth(1); // the tall note, so the box covers several lines of prose

  await long.hover();
  await expect(preview).toBeVisible();
  const box = await rects(page, '.footnote-popover--preview');
  const spot = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };

  // The same point with the box gone and present.
  await page.mouse.move(0, 0);
  await expect(preview).toBeHidden();
  const uncovered = await page.evaluate(
    (at) => document.elementFromPoint(at.x, at.y)?.closest('#post-body') !== null,
    spot,
  );
  expect(uncovered).toBe(true); // the box really is over the article, not over empty margin

  await long.hover();
  await expect(preview).toBeVisible();
  const covered = await page.evaluate(
    (at) => document.elementFromPoint(at.x, at.y)?.closest('.footnote-popover') !== null,
    spot,
  );
  expect(covered).toBe(true);
});

test('moving to another reference drops the previous note at once', async ({ page }) => {
  // §6.1's last rule: otherwise the old note hangs over the new reference through the open delay, and
  // a pinned popover returns early with no close pending.
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');

  await refs(page).first().hover();
  await expect(preview).toContainText('注釈に'); // the `rich` note

  await refs(page).nth(1).hover();
  // Inside the open delay: gone or already the new note, never open with the old text (a closed
  // popover keeps its last content).
  const stale = await preview.evaluate(
    (el) => el.matches(':popover-open') && (el.textContent ?? '').includes('注釈に'),
  );
  expect(stale).toBe(false);
  await expect(preview).toContainText('長い注釈'); // and the new one does arrive
});

test('the preview follows its reference while the pointer stays in it', async ({ page }) => {
  // Criterion 20 on the preview (§6), with the pointer inside the box: on the reference, the page
  // moving is a genuine leave.
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  await refs(page).nth(1).hover();
  await expect(preview).toBeVisible();

  const box = await rects(page, '.footnote-popover--preview');
  await page.mouse.move((box.left + box.right) / 2, box.bottom + 4);
  await page.mouse.move((box.left + box.right) / 2, (box.top + box.bottom) / 2);
  await page.waitForTimeout(300);
  await expect(preview).toBeVisible();

  const gap = async () => {
    const p = await rects(page, '.footnote-popover--preview');
    const r = await rects(page, '#post-body a[data-footnote-ref]', 1);
    return Math.round(Math.min(Math.abs(r.top - p.bottom), Math.abs(p.top - r.bottom)));
  };
  expect(await gap()).toBe(8);
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(300);
  await expect(preview).toBeVisible();
  await expect.poll(gap).toBe(8); // still attached, having moved with the page
});

test('a modifier click is left for the browser', async ({ page }) => {
  await openPost(page);
  // `defaultPrevented` from a later document listener, which then cancels the background tab. A real
  // ctrl+click: the enhancer keys on the preceding pointerdown.
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
  // Clipped: the clamp hides the rest in the box and puts `…` on the last line.
  expect(clamp.scrollHeight).toBeGreaterThan(clamp.clientHeight);
  expect(clamp.clientHeight).toBeCloseTo(clamp.lineHeight * 8, 0);

  // The clamp could have flattened these (§4.3.2), so checked on the clipped note.
  await expect(note.locator('a[href="https://example.com/"]')).toHaveCount(1);
  await expect(note.locator('code')).toHaveCount(1);
  await expect(note.locator('strong')).toHaveCount(1);
});

test('the preview flips below a reference near the top of the viewport', async ({ page }) => {
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  // ~40px down: no room above for the popover.
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
  // Centring vs staying on screen (§5.2.1): at `100vw - 2rem` the clamp nearly always wins.
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
  // Landscape phone. A height cap shows no `…` (§4.3.2), so the note shortens first (§5.2.2).
  await page.setViewportSize({ width: 800, height: 380 });
  await openPost(page);
  const preview = page.locator('.footnote-popover--preview');
  await refs(page).nth(1).hover();
  await expect(preview).toBeVisible();

  await expect(preview.locator('.footnote-popover-note')).toHaveCSS('-webkit-line-clamp', '4');
  const box = await rects(page, '.footnote-popover--preview');
  expect(box.top).toBeGreaterThanOrEqual(-0.5);
  expect(box.bottom).toBeLessThanOrEqual(380 + 0.5);
  // The clamp alone sufficed, no height cap (§5.2.2).
  expect(await preview.evaluate((el) => el.style.maxHeight)).toBe('');
});

test('with room on neither side the height is capped as a last resort', async ({ page }) => {
  // §5.2.2's third branch, reached only when the shortened note still does not fit; the branch that
  // never runs is the one nobody notices is wrong.
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

  // A real Tab: the enhancer asks `:focus-visible`, which scripted focus need not enter.
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

  // WCAG SC 1.4.13: dismissable without moving focus; a `manual` popover gets no platform Escape.
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  expect(await rich.evaluate((el) => el === document.activeElement)).toBe(true);

  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#user-content-fn-rich');
});

test('a reference whose definition is missing keeps its plain anchor', async ({ page }) => {
  // §3.6: the editor refuses an incomplete footnote, so the definition's `id` is renamed in the DOM as
  // it is parsed: the markup arrives twice (HTML and RSC payload), and an observer catches it before
  // the enhancer runs.
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
  // Still an anchor: nothing rewrites `href` or `id` (§3.4).
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
    // The tap did not jump: the one intervention, where no modifier click exists (§3.3).
    expect(await page.evaluate(() => location.hash)).toBe('');

    // It holds a link, so not `aria-hidden`.
    await expect(pinned).not.toHaveAttribute('aria-hidden', 'true');
    await expect(pinned).not.toHaveAttribute('inert', '');

    const jump = pinned.locator('.footnote-popover-jump');
    await expect(jump).toHaveText('定義へ');
    await expect(jump).toHaveAttribute('href', '#user-content-fn-rich');

    // A resize (often the address bar) moves it, not closes it (§6). Measured as the gap on whichever
    // side, since it may flip below (§5.2).
    const gap = async () => {
      const p = await rects(page, '.footnote-popover--pinned');
      const r = await rects(page, '#post-body a[data-footnote-ref]');
      return Math.round(Math.min(Math.abs(r.top - p.bottom), Math.abs(p.top - r.bottom)));
    };
    expect(await gap()).toBe(8);
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(pinned).toBeVisible();
    await expect.poll(gap).toBe(8);

    // On touch this link is the only way to the rest of a clipped note (§4.3.1), and it closes the box.
    await jump.tap();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#user-content-fn-rich');
    await expect(pinned).toBeHidden();
  });

  test('scrolling dismisses the pinned note, but a nudge does not', async ({ page }) => {
    // Touch has no leave, so a scroll is the reader moving on (§6).
    await openPost(page);
    const pinned = page.locator('.footnote-popover--pinned');
    const box = await refs(page).first().boundingBox();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(pinned).toBeVisible();

    // Under the threshold (an address bar, a rubber band): the box stays.
    await page.evaluate(() => window.scrollBy(0, 12));
    await page.waitForTimeout(250);
    await expect(pinned).toBeVisible();

    // Past it: gone.
    await page.evaluate(() => window.scrollBy(0, 60));
    await expect(pinned).toBeHidden();
  });

  test('a tap outside dismisses the pinned note', async ({ page }) => {
    await openPost(page);
    const pinned = page.locator('.footnote-popover--pinned');
    const box = await refs(page).first().boundingBox();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(pinned).toBeVisible();

    // Light dismiss, why `popover="auto"` was chosen (§5.1.1).
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
  // Progressive enhancement (§3.4): without the enhancer the page is as before.
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
