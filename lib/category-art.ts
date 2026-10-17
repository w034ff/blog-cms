import type { Element } from 'hast';
import type { PostCategory } from './content';
import {
  MARK_GLYPH_PATH,
  MARK_SIZE,
  MARK_STROKE_WIDTH,
  MARK_TILE_RADIUS,
  MARK_VIEW_BOX,
} from './site-mark';

// What a post with no image is drawn as: the site's mark (lib/site-mark.ts) in the category's
// colour, on a tint of it (docs/category-mark-requirements.md §3). **Inline `<svg>`, not a file**,
// so the colours come from the page's CSS variables and need no file per scheme (§3.3). Three
// builders share the geometry below — hast for the published card (lib/rehype-link-card.ts), DOM
// for the editor's NodeView, and components/CategoryArt.tsx for React — and
// lib/category-art.test.ts holds the hast and React ones to the same markup.
//
// No colour attribute is written: app/globals.css paints `.category-art-tile` and
// `.category-art-glyph` from `--category-color` and `--surface`.
export const CATEGORY_ART_CLASS = 'category-art';
export const CATEGORY_ART_TILE_CLASS = 'category-art-tile';
export const CATEGORY_ART_GLYPH_CLASS = 'category-art-glyph';

export const CATEGORY_ART_GEOMETRY = {
  viewBox: MARK_VIEW_BOX,
  tile: { width: String(MARK_SIZE), height: String(MARK_SIZE), rx: String(MARK_TILE_RADIUS) },
  glyph: { d: MARK_GLYPH_PATH, strokeWidth: String(MARK_STROKE_WIDTH), strokeLinecap: 'round' },
} as const;

// '' is a draft with no category chosen: no attribute, so `--category-color` keeps the stylesheet's
// default (the foreground) rather than a guessed colour (§3.4).
export function categoryDataAttribute(category: PostCategory): string | undefined {
  return category === '' ? undefined : category;
}

// For the published card. The frame's own classes come first, as the CSS rules for each surface key
// on them (`link-card-image`, `link-card-result-image`).
export function categoryArtHast(frameClasses: string[], category: PostCategory): Element {
  const { viewBox, tile, glyph } = CATEGORY_ART_GEOMETRY;
  const dataCategory = categoryDataAttribute(category);
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: [...frameClasses, CATEGORY_ART_CLASS],
      ...(dataCategory === undefined ? {} : { dataCategory }),
    },
    children: [
      {
        type: 'element',
        tagName: 'svg',
        properties: { viewBox, ariaHidden: 'true', focusable: 'false' },
        children: [
          {
            type: 'element',
            tagName: 'rect',
            properties: {
              className: [CATEGORY_ART_TILE_CLASS],
              width: tile.width,
              height: tile.height,
              rx: tile.rx,
            },
            children: [],
          },
          {
            type: 'element',
            tagName: 'path',
            properties: {
              className: [CATEGORY_ART_GLYPH_CLASS],
              d: glyph.d,
              fill: 'none',
              strokeWidth: glyph.strokeWidth,
              strokeLinecap: glyph.strokeLinecap,
            },
            children: [],
          },
        ],
      },
    ],
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(name: string, attributes: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
  return el;
}

// For the editor's NodeView and the card search's rows. Built with `createElementNS`: an `<svg>`
// made by `createElement` is an unknown HTML element and never draws.
export function categoryArtElement(frameClasses: string[], category: PostCategory): HTMLElement {
  const { viewBox, tile, glyph } = CATEGORY_ART_GEOMETRY;
  const frame = document.createElement('span');
  frame.className = [...frameClasses, CATEGORY_ART_CLASS].join(' ');
  const dataCategory = categoryDataAttribute(category);
  if (dataCategory !== undefined) frame.dataset.category = dataCategory;

  const svg = svgElement('svg', { viewBox, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(
    svgElement('rect', {
      class: CATEGORY_ART_TILE_CLASS,
      width: tile.width,
      height: tile.height,
      rx: tile.rx,
    }),
    svgElement('path', {
      class: CATEGORY_ART_GLYPH_CLASS,
      d: glyph.d,
      fill: 'none',
      'stroke-width': glyph.strokeWidth,
      'stroke-linecap': glyph.strokeLinecap,
    }),
  );
  frame.appendChild(svg);
  return frame;
}
