import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { CategoryArt } from '@/components/CategoryArt';
import { categoryArtHast } from './category-art';
import type { PostCategory } from './content';

// The hast builder (published cards) and the React builder (post list, insert dialog) draw the same
// markup, or the same post would look different on two surfaces. The DOM builder (the editor's
// NodeView) needs a document and vitest runs under `node`; e2e/editor-link-card.spec.ts measures it.
function hastMarkup(frameClasses: string[], category: PostCategory): string {
  const tree = { type: 'root' as const, children: [categoryArtHast(frameClasses, category)] };
  return unified().use(rehypeStringify).stringify(tree);
}

function reactMarkup(className: string, category: PostCategory): string {
  return renderToStaticMarkup(createElement(CategoryArt, { className, category }));
}

describe('the category mark’s builders', () => {
  it.each<PostCategory>(['tech', 'blog', ''])(
    'draw the same markup for the category %j',
    (category) => {
      expect(hastMarkup(['thumb'], category)).toBe(reactMarkup('thumb', category));
    },
  );

  it('carries the category and no colour attribute', () => {
    const html = hastMarkup(['thumb'], 'tech');
    expect(html).toContain('class="thumb category-art" data-category="tech"');
    expect(html).not.toMatch(/\b(fill|stroke)="#/);
  });
});
