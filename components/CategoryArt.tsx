import type { PostCategory } from '@/lib/content';
import {
  CATEGORY_ART_CLASS,
  CATEGORY_ART_GEOMETRY,
  CATEGORY_ART_GLYPH_CLASS,
  CATEGORY_ART_TILE_CLASS,
  categoryDataAttribute,
} from '@/lib/category-art';

type Props = {
  // The surface's own frame: its size, radius and border. The tint and the centring come from
  // `.category-art`.
  className: string;
  category: PostCategory;
};

// The React build of the category-coloured mark (lib/category-art.ts, which holds the geometry and
// the class names). Markup must stay identical to the hast and DOM builders; lib/category-art.test.ts
// compares this one with the hast one.
export function CategoryArt({ className, category }: Props) {
  const { viewBox, tile, glyph } = CATEGORY_ART_GEOMETRY;
  return (
    <span
      className={`${className} ${CATEGORY_ART_CLASS}`}
      data-category={categoryDataAttribute(category)}>
      <svg viewBox={viewBox} aria-hidden='true' focusable='false'>
        <rect
          className={CATEGORY_ART_TILE_CLASS}
          width={tile.width}
          height={tile.height}
          rx={tile.rx}
        />
        <path
          className={CATEGORY_ART_GLYPH_CLASS}
          d={glyph.d}
          fill='none'
          strokeWidth={glyph.strokeWidth}
          strokeLinecap={glyph.strokeLinecap}
        />
      </svg>
    </span>
  );
}
