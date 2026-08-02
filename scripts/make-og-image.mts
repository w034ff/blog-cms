import path from 'node:path';
import { chromium } from '@playwright/test';

// Regenerates public/og.png, the card image every share of this site carries.
//
//   node scripts/make-og-image.mts
//
// Committed as a generator rather than only as a PNG so the design is reviewable
// as markup and can be changed without anyone opening an image editor — and so
// the answer to "where did this file come from" is in the repo.
//
// Rendered by screenshotting real Chrome rather than by Next's ImageResponse.
// Satori (what ImageResponse uses) needs the font bytes handed to it, and the
// text here is Japanese: the only ways to feed it are vendoring a CJK font — the
// Noto Sans JP on this machine is 9.6MB, and there is no subsetting tool here —
// or fetching one at render time, which would make a self-hosted blog's share
// card depend on a third party being reachable. A browser already has the fonts.
// The output is a static file, so nothing about this runs in production.
const OUT = path.join(process.cwd(), 'public', 'og.png');

// The sizes every consumer (Slack, X, Discord, iMessage) expects.
const WIDTH = 1200;
const HEIGHT = 630;

const TITLE = 'Tech Blog';
const SUBTITLE = '個人技術ブログ';

// Deliberately no URL text: the site's address has already moved once and is
// meant to move again, and an address baked into a binary is the one place it
// cannot be updated from an environment variable.
const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 96px;
        background: #ffffff;
        /* The site's own foreground/accent (app/globals.css). */
        color: #171717;
        font-family: "Noto Sans JP", "Yu Gothic", Meiryo, system-ui, sans-serif;
      }
      /* The red rule stands in for the site's accent on h2/h3 and the 強調 mark. */
      .rule { width: 96px; height: 10px; background: #cf222e; border-radius: 999px; }
      h1 { margin-top: 40px; font-size: 104px; font-weight: 800; letter-spacing: -0.02em; }
      p { margin-top: 24px; font-size: 40px; color: #52525b; }
    </style>
  </head>
  <body>
    <div class="rule"></div>
    <h1>${TITLE}</h1>
    <p>${SUBTITLE}</p>
  </body>
</html>`;

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    // 1 device pixel per CSS pixel, so the PNG is exactly 1200×630.
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  // Webfonts are not involved (system fonts only), but the layout still settles a
  // frame after setContent.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT });
  console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT})`);
} finally {
  await browser.close();
}
