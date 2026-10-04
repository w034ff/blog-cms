// What a link card draws in its picture slot, and the one place that decides that a card pointing
// at this blog always has one (docs/link-card-requirements.md §17).
//
// Above `resolveThumbnail` (a post's image, kept to `/uploads/…` for `og:image` and the upload
// sweep) and `linkImageSrc` (a signed proxy path, §14.4): given either's answer, this says what the
// card draws. **Both surfaces read it**, since deciding separately drew the same image two ways
// (§13, §16.4).
export type CardImage = {
  // Always same-origin, which lib/rehype-link-card.ts relies on in not re-validating it.
  src: string;
  // The house mark: painted `object-fit: contain` on a tint and wrapped in a `<picture>`. Carried
  // here, not derived by comparing `src`, which would break on a rename.
  placeholder: boolean;
};

// The house mark in two schemes. Static files, not uploads, so the upload sweep never sees it and
// it resolves before any DB read. **Two files and a `<picture>`**: the mark is the site's name in the
// foreground colour, so the wrong file is invisible, and the page's `<source media>` is the mechanism
// the rest of globals.css relies on (§17.3), unlike an SVG's own `prefers-color-scheme`.
export const CARD_PLACEHOLDER_SRC = '/link-card-placeholder.svg';
export const CARD_PLACEHOLDER_DARK_SRC = '/link-card-placeholder-dark.svg';

// A card to one of this blog's posts. **It always has a picture**, the house mark when the post has
// none (§17).
export function internalCardImage(thumbnail: string | null): CardImage {
  return thumbnail === null
    ? { src: CARD_PLACEHOLDER_SRC, placeholder: true }
    : { src: thumbnail, placeholder: false };
}

// A card to anywhere else. **No fallback:** the house mark would claim the page as this blog's, and
// the target's icon is refused (§14.4, link-requirements.md §5.5.8). No og:image means text only
// (§16.2).
export function externalCardImage(src: string | null): CardImage | null {
  return src === null ? null : { src, placeholder: false };
}
