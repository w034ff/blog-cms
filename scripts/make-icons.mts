import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  MARK_DARK,
  MARK_GLYPH_PATH,
  MARK_LIGHT,
  MARK_SIZE,
  MARK_STROKE_WIDTH,
  MARK_TILE_RADIUS,
  MARK_VIEW_BOX,
  markSvg,
} from '../lib/site-mark.ts';

// Regenerates the site's icons from the mark's one geometry (lib/site-mark.ts):
//
//   node scripts/make-icons.mts
//
//   app/icon.svg       the tab icon. It follows the OS scheme itself, which Chrome and Firefox honour.
//   app/favicon.ico    16 and 32px, for what asks /favicon.ico without reading the page's links.
//   app/apple-icon.png 180px for a home screen. Full-bleed, no rounded corners: iOS rounds it,
//                      and paints whatever is transparent black.
//
// A generator, so the files' origin is in the repo (as scripts/make-og-image.mts for og.png).
const APP = path.join(process.cwd(), 'app');

const iconSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEW_BOX}">` +
  `<style>rect{fill:${MARK_LIGHT.tile}}path{stroke:${MARK_LIGHT.glyph}}` +
  `@media (prefers-color-scheme: dark){rect{fill:${MARK_DARK.tile}}path{stroke:${MARK_DARK.glyph}}}</style>` +
  `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${MARK_TILE_RADIUS}"/>` +
  `<path d="${MARK_GLYPH_PATH}" fill="none" stroke-width="${MARK_STROKE_WIDTH}" stroke-linecap="round"/>` +
  `</svg>\n`;
await writeFile(path.join(APP, 'icon.svg'), iconSvg);

const APPLE_SIZE = 180;
const appleSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEW_BOX}" width="${APPLE_SIZE}" height="${APPLE_SIZE}">` +
  `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="${MARK_LIGHT.tile}"/>` +
  `<path d="${MARK_GLYPH_PATH}" fill="none" stroke="${MARK_LIGHT.glyph}" stroke-width="${MARK_STROKE_WIDTH}" stroke-linecap="round"/>` +
  `</svg>`;
await sharp(Buffer.from(appleSvg)).png().toFile(path.join(APP, 'apple-icon.png'));

// An ICO that wraps PNGs (supported by every browser that reads ICO at all): a 6-byte header, a
// 16-byte entry per image, then the images.
const FAVICON_SIZES = [16, 32];
const pngs = await Promise.all(
  FAVICON_SIZES.map((size) =>
    sharp(Buffer.from(markSvg(MARK_LIGHT, size)))
      .png()
      .toBuffer(),
  ),
);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(FAVICON_SIZES[i], 0);
  entry.writeUInt8(FAVICON_SIZES[i], 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
await writeFile(path.join(APP, 'favicon.ico'), Buffer.concat([header, ...entries, ...pngs]));

console.log('wrote app/icon.svg, app/apple-icon.png, app/favicon.ico');
