import path from 'node:path';
import { chromium } from '@playwright/test';
import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME } from '../app/shared-metadata.ts';
import { MARK_LIGHT, markSvg } from '../lib/site-mark.ts';

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

const TITLE = DEFAULT_SITE_NAME;
const SUBTITLE = DEFAULT_SITE_DESCRIPTION;
// The mark above the name, at the size the name's cap height reads against.
const MARK_PX = 112;

// The site's face (app/layout.tsx), fetched from Google Fonts for these characters only, so the
// generator needs the network. Checked after load: a stylesheet that fails to arrive declares no
// face, and the card would quietly come out in a system font.
const FONT_FAMILY = 'IBM Plex Sans JP';
const FONT_CSS = `https://fonts.googleapis.com/css2?family=${FONT_FAMILY.replaceAll(' ', '+')}:wght@400;700&text=${encodeURIComponent(TITLE + SUBTITLE)}&display=block`;

// No URL text: the address moves, and a PNG cannot read an environment variable.
const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${FONT_CSS}" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 96px;
        /* The site's light ground (--background, app/globals.css). */
        background: #f3eef8;
        /* The site's own foreground/accent (app/globals.css). */
        color: #171717;
        font-family: "${FONT_FAMILY}", sans-serif;
      }
      h1 { margin-top: 40px; font-size: 104px; font-weight: 700; letter-spacing: -0.02em; }
      p { margin-top: 24px; font-size: 40px; color: #52525b; }
    </style>
  </head>
  <body>
    ${markSvg(MARK_LIGHT, MARK_PX)}
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
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(
    (family) =>
      [...document.fonts].filter((face) => face.family.includes(family) && face.status === 'loaded')
        .length,
    FONT_FAMILY,
  );
  if (loaded < 2)
    throw new Error(`${FONT_FAMILY} did not load (${loaded} of 2 weights); is the network up?`);
  await page.screenshot({ path: OUT });
  console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT})`);
} finally {
  await browser.close();
}
