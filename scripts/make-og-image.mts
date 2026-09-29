import path from 'node:path';
import { chromium } from '@playwright/test';

// Regenerates public/og.png, the site's share card.
//
//   node scripts/make-og-image.mts
//
// A generator, so the design is reviewable markup and the file's origin is in the repo. A Chrome
// screenshot, not ImageResponse: Satori needs font bytes, and Japanese would mean vendoring a ~10MB
// CJK font or fetching one at render time. The output is static.
const OUT = path.join(process.cwd(), 'public', 'og.png');

// The size share consumers expect.
const WIDTH = 1200;
const HEIGHT = 630;

const TITLE = 'Tech Blog';
const SUBTITLE = '個人技術ブログ';

// No URL text: the address moves, and a PNG cannot read an environment variable.
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
      .rule { width: 96px; height: 10px; background: #9f1239; border-radius: 999px; }
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
  // System fonts only, but layout settles a frame after setContent.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT });
  console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT})`);
} finally {
  await browser.close();
}
