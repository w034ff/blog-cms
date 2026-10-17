// The site's mark: 「±」 on a rounded tile (docs/project-status.md §3). Every surface that draws it
// takes this geometry — SiteMark in the header, app/icon.svg, the favicon and apple icon
// (scripts/make-icons.mts), og.png (scripts/make-og-image.mts) and the category-coloured mark of
// an imageless post (lib/category-art.ts). The static file cannot import it, so
// lib/site-mark.test.ts holds it to it.
export const MARK_VIEW_BOX = '0 0 32 32';
export const MARK_SIZE = 32;
export const MARK_TILE_RADIUS = 7;
// The plus over the minus. Drawn as strokes with round caps, so one width sets both glyphs.
export const MARK_GLYPH_PATH = 'M16 7v8M12 11h8M12 22h8';
export const MARK_STROKE_WIDTH = 3;

// The two colours of a file that cannot read the page's variables: the tile is the site's
// foreground and the glyph its surface (app/globals.css `--foreground`, `--surface`), swapped in
// the dark scheme as those variables are.
export const MARK_LIGHT = { tile: '#171717', glyph: '#ffffff' };
export const MARK_DARK = { tile: '#ededed', glyph: '#18181b' };

// The mark as a standalone SVG document, for the generated files.
export function markSvg(colors: { tile: string; glyph: string }, size: number = MARK_SIZE): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEW_BOX}" width="${size}" height="${size}">` +
    `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${MARK_TILE_RADIUS}" fill="${colors.tile}"/>` +
    `<path d="${MARK_GLYPH_PATH}" fill="none" stroke="${colors.glyph}" stroke-width="${MARK_STROKE_WIDTH}" stroke-linecap="round"/>` +
    `</svg>`
  );
}
