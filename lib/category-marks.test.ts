import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/lib/content';

// app/globals.css gives each category a dot colour by id (`.category-mark[data-category=…]`). A
// category added to CATEGORIES without one renders with no dot and nothing fails, so this keeps
// the two lists in step.
const css = readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8');

describe('category marks', () => {
  for (const { id } of CATEGORIES) {
    it(`${id} has a colour and a rule`, () => {
      expect(css).toMatch(new RegExp(`--category-${id}:`));
      expect(css).toContain(`.category-mark[data-category='${id}']`);
    });
  }
});
