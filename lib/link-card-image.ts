import type { PostCategory } from './content';

// What a link card draws in its picture slot, and the one place that decides that a card pointing
// at this blog always has one (docs/link-card-requirements.md §17, docs/category-mark-requirements.md).
//
// Above `resolveThumbnail` (a post's image, kept to `/uploads/…` for `og:image` and the upload
// sweep) and `linkImageSrc` (a signed proxy path, §14.4): given either's answer, this says what the
// card draws. **Every surface reads it**, since deciding separately drew the same image two ways
// (§13, §16.4).
export type CardImage =
  // Always same-origin, which lib/rehype-link-card.ts relies on in not re-validating it.
  | { kind: 'photo'; src: string }
  // The category-coloured site mark (lib/category-art.ts): inline markup, so it carries the
  // category rather than a file. Not derived from a missing `src` by the surfaces.
  | { kind: 'mark'; category: PostCategory };

// A card to one of this blog's posts. **It always has a picture**, the category's mark when the post
// has none. `category` may be '' for a draft; the mark then takes the default colour instead of a
// guessed one (docs/category-mark-requirements.md §3.4).
export function internalCardImage(thumbnail: string | null, category: PostCategory): CardImage {
  return thumbnail === null ? { kind: 'mark', category } : { kind: 'photo', src: thumbnail };
}

// A card to anywhere else. **No fallback:** the site's mark would claim the page as this blog's, and
// the target's icon is refused (§14.4, link-requirements.md §5.5.8). No og:image means text only
// (§16.2).
export function externalCardImage(src: string | null): CardImage | null {
  return src === null ? null : { kind: 'photo', src };
}
