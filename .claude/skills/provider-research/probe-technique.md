# Measuring a third-party embed

Measure the provider's iframe directly — not through the app, and not with curl. An embed endpoint
returns a small shell that loads its own JS inside the frame, so only a real browser answers whether
it renders.

## The shape that works

- One `.mjs` in the scratchpad. Import Playwright by absolute path
  (`<repo>/node_modules/playwright/index.mjs`); a scratchpad file cannot resolve the repo's
  `node_modules`.
- `chromium.launch({ channel: 'chrome' })` — system Chrome, as in `playwright.config.ts`. No bundled
  browsers are installed.
- Serve the parent page from `node:http` on a free port. `file://` is origin `null`, which changes
  postMessage behaviour.
- Record messages with `page.evaluate` over an array the page fills, and count third-party requests
  with `page.on('request')`.
- Playwright can `evaluate` inside a cross-origin iframe, so you can read what the embed actually
  rendered. That is how "renders but withholds the height message" was told apart from "does not
  render" (X, 2026-08-23).

## Traps that gave wrong answers first

- **Batching frames against a Cloudflare-fronted provider trips a managed challenge** (CodePen,
  2026-08-31). Ten embeds in quick succession from one IP were enough; the challenge is a 403 with
  `X-Frame-Options: SAMEORIGIN`, so in a frame it becomes chrome-error, and it kept refusing for 20+
  minutes across fresh browser contexts, including a pen that had rendered minutes earlier. A
  60-item batch gave 10 ok / 54 "refused", all artifact. Sampling destroys the population, so a
  per-item refusal rate is not obtainable this way. One frame per context, spaced out, and re-test a
  known-good item to prove the client is still clean before believing any negative.
- **Headless Chrome can be served a bot wall in place of the embed** (SlideShare, 2026-08-25):
  Fastly's "Client Challenge" ("cookies are disabled") reads exactly like "this URL is not a
  route". Headed, the same URLs rendered 6/6. Run any decisive negative headed as well as headless.
  `curl` and `node fetch` get the challenge too (a ~3KB body with `cache-control: private,
no-store`; a real hit carries `x-cache: HIT`).
- Scrolling to `document.body.scrollHeight` can leave every embed off-screen when a trailing spacer
  fills the viewport. Scroll each element with `scrollIntoViewIfNeeded` and re-check.
- `transferSize` is 0 for cross-origin resources: request counts are measurable, bytes are not.
- CDP `Performance.getMetrics` excludes cross-origin iframes (site isolation). It shows the host
  page's main thread is untouched; it does not measure the embed.
- Verify that a "bogus" id is bogus — `1234567890` is a real 2009 post on X. Find fixtures by
  loading a batch (one at a time, per the first trap) and reading which report results.

## Afterwards

Put the numbers in `docs/embed-requirements.md` next to the conclusion they justify; fixture URLs
belong in its tables, which the tests cite. The probe scripts stay in the scratchpad and are not
committed.
