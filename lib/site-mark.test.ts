import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MARK_GLYPH_PATH,
  MARK_STROKE_WIDTH,
  MARK_TILE_RADIUS,
  markSvg,
  MARK_LIGHT,
} from './site-mark';

// The files that draw the mark but cannot import its geometry: the hand-written link-card
// placeholders and the generated tab icon. A redrawn mark that misses one of them fails here.
const STATIC_MARKS = [
  'public/link-card-placeholder.svg',
  'public/link-card-placeholder-dark.svg',
  'app/icon.svg',
];

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('the site mark (lib/site-mark.ts)', () => {
  it.each(STATIC_MARKS)('%s draws the same tile and glyph', (file) => {
    const svg = read(file);
    expect(svg).toContain(`d="${MARK_GLYPH_PATH}"`);
    expect(svg).toContain(`rx="${MARK_TILE_RADIUS}"`);
    expect(svg).toContain(`stroke-width="${MARK_STROKE_WIDTH}"`);
  });

  it('builds a standalone document from the same geometry', () => {
    const svg = markSvg(MARK_LIGHT, 16);
    expect(svg).toContain('width="16"');
    expect(svg).toContain(`d="${MARK_GLYPH_PATH}"`);
    expect(svg).toContain(`fill="${MARK_LIGHT.tile}"`);
  });
});
