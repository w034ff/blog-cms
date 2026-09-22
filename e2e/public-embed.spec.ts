import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown } from './editor-authoring';
import { shot } from './editor-probe';
import { publishedPath } from './published-post';

// The YouTube embed on the *published* page (docs/embed-requirements.md §6, §9.5).
//
// lib/render.test.ts measures the rehype stage against a string. Two things exist only beyond that
// string, and this file is where they are:
//
//   1. The stage's position in the real pipeline. `<iframe>` is not in the sanitize schema, so an
//      iframe on a published page is itself the evidence that rehypeEmbed runs after
//      rehypeSanitize — move it before, and the element the stage builds is stripped.
// Everything is scoped to `#post-body`: `.prose` also matches the two footnote popovers on the
// page, which are empty and would make any text assertion a strict-mode violation.
//
//   2. The CSS. The ratio is held by a wrapper because an `<iframe>` given `aspect-ratio` alone
//      negotiates its own size — a claim about layout that nothing but a browser can settle.

const ID = 'hDPybQwAuVo';
const SRC = `https://www.youtube-nocookie.com/embed/${ID}`;

async function publish(page: Page, title: string, source: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await loadMarkdown(page, source);

  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  return publishedPath(page);
}

test('a published reference becomes an iframe in a 16:9 box (§9.5)', async ({ page }) => {
  const href = await publish(
    page,
    'Public embed spec',
    `本文の前。\n\n<div class="embed" data-href="https://www.youtube.com/watch?v=${ID}&amp;t=90"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-youtube .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  await expect(iframe).toHaveAttribute('src', `${SRC}?start=90`);
  // Below the fold this is what keeps the third party unasked until the reader scrolls (§9.5). The
  // request itself cannot be removed — that is §8-① — only made to follow the reader's attention.
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The ratio, measured rather than read off the stylesheet: the wrapper exists precisely because
  // an iframe given `aspect-ratio` by itself does not take it.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  // The player fills the box it was given, rather than sizing the box.
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);

  await expect(page.locator('#post-body')).toContainText('本文の前。');
  await shot(page, '06-public-embed');
});

test('a reference naming no single video is published as a plain link (Y4)', async ({ page }) => {
  const href = await publish(
    page,
    'Public embed fallback spec',
    '<div class="embed" data-href="https://www.youtube.com/playlist?list=PLabc"></div>\n',
  );
  await page.goto(href);

  await expect(page.locator('#post-body iframe')).toHaveCount(0);
  // Nothing is lost for the reader, and the author sees a link where they expected a player —
  // dropping the node instead would make the body silently shorter.
  await expect(
    page.locator('#post-body a[href="https://www.youtube.com/playlist?list=PLabc"]'),
  ).toHaveCount(1);
});

test('a hand-written javascript: reference becomes nothing at all (E2)', async ({ page }) => {
  // Both exits have to refuse it: the iframe, and the plain-link fallback — which is published
  // markup built after sanitize as well, and which let it through until lib/render.test.ts asked.
  const href = await publish(
    page,
    'Public embed protocol spec',
    '本文。\n\n<div class="embed" data-href="javascript:alert(1)"></div>\n',
  );
  await page.goto(href);

  await expect(page.locator('#post-body')).toContainText('本文。');
  await expect(page.locator('#post-body iframe')).toHaveCount(0);
  expect(await page.locator('#post-body').innerHTML()).not.toContain('javascript:');
});

// docs/embed-requirements.md §14.4, criterion S6. The deck itself is never fetched: SlideShare is
// routed to a blank page of our own, because what this measures is the box, and a spec that leans
// on a third party's uptime measures that instead. The stub also stands in for the `302 →
// embed_code/key/<KEY>` the real host answers with (§14.3) — the redirect belongs to the reader's
// browser, and nothing here depends on where it lands.
const DECK = 'https://www.slideshare.net/slideshow/slidesharesample-260753333/260753333';

test('a deck reference is published in a 16:9 + 38px box the player fills (S6)', async ({
  page,
}) => {
  await page.route('https://www.slideshare.net/slideshow/embed_code/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public slideshare spec',
    `本文の前。\n\n<div class="embed" data-href="${DECK}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-slideshare .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  await expect(iframe).toHaveAttribute(
    'src',
    'https://www.slideshare.net/slideshow/embed_code/260753333',
  );
  // Full screen is this attribute's business and not the `allow` string's (§14.4).
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The box, measured rather than read off the stylesheet — the wrapper is what holds it. Not a
  // ratio: the control row is 38px whatever the box is, so the height is the slide area's 16:9 plus
  // that row (§14.4). A ratio assertion would pass at exactly one width and say nothing at another.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeCloseTo(box!.width * (9 / 16) + 38, 0);
  // Wide enough that the criterion is not vacuous: a box narrower than the column would pass the
  // ratio check while saying nothing about the column it sits in.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
});

// docs/embed-requirements.md §15.3, criterion F7. The file itself is never fetched, for the reason
// the deck is not: `embed.figma.com` is routed to a blank page of our own, since what this measures
// is the box. The stub also stands in for the `302 → www.figma.com/design/<key>?…&viewer=1` the
// real host answers with — the redirect belongs to the reader's browser.
const DESIGN = 'https://www.figma.com/design/7or4V8Tl8YbEFRmMSF3pXe/Figma-sample?node-id=5-2&p=f';

test('a design reference is published in a 16:9 box the viewer fills (F7)', async ({ page }) => {
  await page.route('https://embed.figma.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public figma spec',
    `本文の前。\n\n<div class="embed" data-href="${DESIGN}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-figma .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // The key form, with the linked node carried and `p=f` dropped (§15.4).
  await expect(iframe).toHaveAttribute(
    'src',
    'https://embed.figma.com/design/7or4V8Tl8YbEFRmMSF3pXe?embed-host=tech-blog&node-id=5-2',
  );
  // Full screen is this attribute's business and not the `allow` string's (§15.3).
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The ratio, measured rather than read off the stylesheet — the wrapper is what holds it.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  expect(box!.width).toBeGreaterThan(400);
  // The viewer fills the box inside the frame's own 1px rule (§15.4) — `box-sizing` is border-box,
  // so the ratio above describes the block the reader sees, and this is what is left for the
  // iframe. Asserted rather than tolerated: the rule is the block's edge, and an iframe painting
  // over it would be the same block with no line around it.
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height - 2, 0);
  expect(inner!.width).toBeCloseTo(box!.width - 2, 0);
});

// docs/embed-requirements.md §16.4, criterion SD6. The deck itself is never fetched, for the reason
// the SlideShare one is not: `speakerdeck.com/player/**` is routed to a blank page of our own, since
// what this measures is the box. There is no redirect to stand in for here — the reference is
// already the player's own URL (§16.3), which is the whole of what makes this provider different.
const SLIDES = 'https://speakerdeck.com/player/9de2f18094b14cbb91b07331eb085e4f';

test('a Speaker Deck reference is published in a 16:9 box the player fills (SD6)', async ({
  page,
}) => {
  await page.route('https://speakerdeck.com/player/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public speakerdeck spec',
    `本文の前。\n\n<div class="embed" data-href="${SLIDES}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-speakerdeck .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  await expect(iframe).toHaveAttribute('src', SLIDES);
  // Full screen is this attribute's business and not the `allow` string's (§16.4).
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The ratio, measured rather than read off the stylesheet — the wrapper is what holds it. One
  // ratio suffices here where SlideShare needed a sum: Speaker Deck draws its controls over the
  // slide rather than beside it, so the frame is the slide area (§16.4).
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  // Wide enough that the criterion is not vacuous: a box narrower than the column would pass the
  // ratio check while saying nothing about the column it sits in.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
  expect(inner!.width).toBeCloseTo(box!.width, 0);
});

// docs/embed-requirements.md §17.4, criterion D7. The deck itself is never fetched, for the reason
// the SlideShare and Speaker Deck ones are not: `www.docswell.com/slide/**` is routed to a blank
// page of our own, since what this measures is the box.
const DOCSWELL_DECK = 'https://www.docswell.com/s/ku-suke/LK7J5V-hello-docswell#p5';

test('a Docswell reference is published in a slide-plus-control-row box (D7)', async ({ page }) => {
  await page.route('https://www.docswell.com/slide/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public docswell spec',
    `本文の前。\n\n<div class="embed" data-href="${DOCSWELL_DECK}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-docswell .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // The embed form built from the key, with the page the author was pointing at carried (§17.3).
  await expect(iframe).toHaveAttribute('src', 'https://www.docswell.com/slide/LK7J5V/embed#p5');
  // Full screen is this attribute's business and not the `allow` string's (§17.4).
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The box, measured rather than read off the stylesheet — the wrapper is what holds it. Not a
  // ratio, for SlideShare's reason: the control bar is 56px whatever the box is, so the height is
  // the slide area's 16:9 plus that bar (§17.4). A ratio assertion would pass at exactly one width.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeCloseTo(box!.width * (9 / 16) + 56, 0);
  // Wide enough that the criterion is not vacuous: a box narrower than the column would pass the
  // height check while saying nothing about the column it sits in.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
  expect(inner!.width).toBeCloseTo(box!.width, 0);
});

// docs/embed-requirements.md §18.4 and §18.5, criteria G7, G10 and G11.
//
// **GitHub is never reached here, and it cannot be stubbed either.** The frame is sandboxed without
// `allow-same-origin`, and a request from an opaque-origin frame does not pass through Playwright's
// routing — measured 2026-08-29, both `page.route` and `context.route` were bypassed and the real
// gist rendered. So the loop is measured in two halves that between them touch every line of it:
// G7/G10 drive the parent's half with the message its own document would have sent, and G11 runs
// that document for real against a script served from this file.
const GIST = 'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae?file=hello.rb';

// The message the reporter posts, delivered directly. **`source` is the named box's own frame**,
// because that is what the published listener authenticates by: the gist's origin is the string
// `"null"` (§18.5), and the id alone names a placement rather than proving anything about the
// sender — see the impersonation test below. Setting it here is what keeps this the same code path
// the frame's own message takes, as `e2e/editor-embed.spec.ts` does for the other surface.
async function report(page: Page, id: string, height: number, files: number): Promise<void> {
  await page.evaluate(
    ([source, embedId, h, n]) => {
      const frame = document.querySelector<HTMLIFrameElement>(
        `#post-body [data-embed-id="${embedId}"] iframe`,
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source, id: embedId, height: h, files: n },
          source: frame?.contentWindow ?? undefined,
        }),
      );
    },
    ['gist-embed', id, height, files] as const,
  );
}

test('a gist is published as a srcdoc whose box follows the report (G7)', async ({ page }) => {
  const href = await publish(
    page,
    'Public gist spec',
    `本文の前。\n\n<div class="embed" data-href="${GIST}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-gist .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // The document is ours; GitHub's script is loaded from inside it (§18.5).
  expect(await iframe.getAttribute('src')).toBeNull();
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
  const srcdoc = (await iframe.getAttribute('srcdoc'))!;
  expect(srcdoc).toContain(
    'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae.js?file=hello.rb',
  );
  expect(srcdoc).toContain('gist-embed');

  // Published at the guess (§18.4), then corrected. **The guess itself is not asserted**: this
  // environment reaches GitHub, the frame cannot be stubbed (see the note above), and the real
  // gist's own report lands first — so what is measured is that a report moves the box, with a
  // height no gist would coincidentally have.
  expect((await frame.boundingBox())!.height).toBeLessThan(400);
  await report(page, 'emb-0', 612, 1);
  // **The transition, not the exact pixel.** This environment reaches GitHub and the frame cannot
  // be stubbed, so the real gist is live inside it: given a taller box it re-measures and reports
  // again, landing 2px under what was asked for (the frame is the box less its own 1px rule). That
  // second report is the mechanism working, so the assertion is on the move rather than on a value
  // only a dead frame would hold still at.
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeGreaterThan(600);
  // Wide enough that the criterion is not vacuous: a box narrower than the column would pass the
  // height check while saying nothing about the column it sits in.
  expect((await frame.boundingBox())!.width).toBeGreaterThan(400);
});

// docs/embed-requirements.md §18.5, criterion G12. **The same rule the editor's §10.10 test states,
// for the surface that holds every box on the page at once.**
//
// `data-embed-id` is published in the markup and minted as `emb-0`, `emb-1`, …, and every iframe on
// the page can post to the parent. That was harmless while every frame held a document its own
// provider wrote; §20 and §21 put frames on the page whose contents are written by whoever made
// that sandbox or pen. So a message is answered only when it came from the frame of the box it
// names — which is what the rogue below is refused by, and the report after it is admitted by.
test('a frame answering under another box’s id is ignored (G12)', async ({ page }) => {
  const href = await publish(
    page,
    'Public gist impersonation spec',
    `<div class="embed" data-href="${GIST}"></div>\n`,
  );
  await page.goto(href);
  await expect(page.locator('#post-body .embed-gist')).toHaveCount(1);

  // A second frame of its own, running its own script — the shape a pen's author has. It names the
  // gist's placement and reports zero files, which is the message that retires a box (G10). The
  // wait is on the parent having HEARD it, so the assertion below cannot pass by the message never
  // arriving.
  await page.evaluate(async (victim) => {
    const rogue = document.createElement('iframe');
    rogue.style.cssText = 'position:fixed;left:0;bottom:0;width:10px;height:10px';
    rogue.srcdoc =
      `<script>parent.postMessage({source:'gist-embed',id:${JSON.stringify(victim)},` +
      `height:0,files:0},'*')</script>`;
    document.body.appendChild(rogue);
    await new Promise<void>((resolve) => {
      window.addEventListener('message', function seen(event) {
        if (event.source !== rogue.contentWindow) return;
        window.removeEventListener('message', seen);
        resolve();
      });
    });
  }, 'emb-0');

  // Heard by the page, refused by the box.
  await expect(page.locator('#post-body .embed-gist')).toHaveCount(1);
  await expect(page.locator(`#post-body a[href="${GIST}"]`)).toHaveCount(0);
  // And the box still answers its own frame — without which the assertion above would pass for a
  // listener that had stopped accepting anything at all.
  await report(page, 'emb-0', 612, 1);
  await expect
    .poll(
      async () => (await page.locator('#post-body .embed-gist .embed-frame').boundingBox())!.height,
    )
    .toBeGreaterThan(600);
});

test('a gist that drew no files is replaced with a plain link (G10)', async ({ page }) => {
  // GitHub's script writes nothing at all for an id that no longer resolves, which is why the file
  // count rather than silence is the signal (§18.5) — silence has its own path, the §10.6 clock,
  // and this is the one that does not make the reader wait eight seconds for it.
  const href = await publish(
    page,
    'Public gist fallback spec',
    `<div class="embed" data-href="${GIST}"></div>\n`,
  );
  await page.goto(href);
  await expect(page.locator('#post-body .embed-gist')).toHaveCount(1);

  await report(page, 'emb-0', 250, 0);
  const link = page.locator(`#post-body a[href="${GIST}"]`);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.locator('#post-body iframe')).toHaveCount(0);
});

// docs/embed-requirements.md §20.6, criterion C7. The sandbox itself is never booted, for the
// reason the deck above is never fetched: `codesandbox.io/embed/**` is routed to a blank page of
// our own, since what this measures is the box. Booting the real thing would put 64 third-party
// requests into the suite to assert a number that is in the stylesheet.
const CODESANDBOX_PAGE = 'https://codesandbox.io/p/sandbox/react-example-xgzdk';

test('a CodeSandbox reference is published in a fixed 500px box (C7)', async ({ page }) => {
  await page.route('https://codesandbox.io/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public codesandbox spec',
    `本文の前。\n\n<div class="embed" data-href="${CODESANDBOX_PAGE}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-codesandbox .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // The whole segment, and the `runonclick=1` this project adds rather than the author (§20.5).
  await expect(iframe).toHaveAttribute(
    'src',
    'https://codesandbox.io/embed/react-example-xgzdk?runonclick=1',
  );
  // The pair measured together in §20.7: no device is asked for, and the frame cannot navigate the
  // article away because `allow-top-navigation` is absent from this list.
  await expect(iframe).toHaveAttribute('allow', '');
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
  );
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The box, measured rather than read off the stylesheet. **Not a ratio and not a correction**:
  // a sandbox has no shape of its own, and its frame's resize message is unusable (§20.6), so 500
  // is the whole answer and it does not move with the width.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeCloseTo(500, 0);
  // Wide enough that the criterion is not vacuous: a box narrower than the column would pass the
  // height check while saying nothing about the column it sits in.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
  expect(inner!.width).toBeCloseTo(box!.width, 0);
});

// docs/embed-requirements.md §21.6, criterion P7. The pen is never run, for the reason the sandbox
// above is never booted: `codepen.io/*/embed/**` is routed to a blank page of our own, since what
// this measures is the box. Routing it also keeps §21.13's rate challenge out of the suite — a run
// that loaded real pens would be measuring how many CodePen has served this IP lately.
const CODEPEN_PAGE = 'https://codepen.io/flatsato/pen/VwqprLp';

test('a CodePen reference is published in a 450px box that keeps 300px on a narrow column (P7)', async ({
  page,
}) => {
  await page.route('https://codepen.io/*/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public codepen spec',
    `本文の前。\n\n<div class="embed" data-href="${CODEPEN_PAGE}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-codepen .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // **`/pen/` → `/embed/` and not one parameter after it** (§21.5): the author's user segment is
  // carried, Zenn's `embed-version=2` is not added, and no panel or palette is chosen for them.
  await expect(iframe).toHaveAttribute('src', 'https://codepen.io/flatsato/embed/VwqprLp');
  await expect(iframe).toHaveAttribute('allow', '');
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
  );
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The box, measured rather than read off the stylesheet. Not a ratio and not a correction: the
  // frame reports nothing at all (§21.6), so the height is a chosen number — two of them, since a
  // wide column takes 450 and a narrow one keeps the provider's documented 300.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeCloseTo(450, 0);
  // Wide enough that the criterion is not vacuous, as C7 above.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
  expect(inner!.width).toBeCloseTo(box!.width, 0);

  // Below the breakpoint the same box is 300px. Measured on the published page rather than by
  // reading the media query, which is the half that would still pass if the rule were dropped.
  await page.setViewportSize({ width: 412, height: 915 });
  const narrow = await frame.boundingBox();
  expect(narrow!.height).toBeCloseTo(300, 0);
  expect(narrow!.width).toBeLessThan(400);
});
