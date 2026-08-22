// What a link card draws in its picture slot, and the one place that decides that a card pointing
// at this blog always has one (docs/link-card-requirements.md §17).
//
// Not `lib/thumbnail.ts` and not `lib/link-image.ts`, though both answer a neighbouring question.
// `resolveThumbnail` decides what a *post's* image is, and its answer is deliberately narrowed to a
// `/uploads/…` path because it also reaches `og:image` and `scripts/gc-uploads.mts`'s reference
// sweep; widening it to hand back a house asset would break that. `linkImageSrc` signs a third
// party's picture into a same-origin proxy path (§14.4). This module sits above both: given the
// answer either of them produced, it says what the card puts on screen.
//
// **Both surfaces read it.** The published card resolves through `app/posts/[slug]/page.tsx` and
// the editor's through `/api/posts/search`, and §13 / §16.4 are the record of what it costs when
// the two decide a picture separately — the same image drawn in two different boxes, and a card
// that lost its image on every rebuild after the fetching one.
export type CardImage = {
  // Same-origin in every case, which is the property `lib/rehype-link-card.ts` relies on when it
  // does not re-validate this: an upload path, a signed `/api/link-image` path, or the constant
  // below. A card never points a reader at another site's server.
  src: string;
  // The picture is the house asset rather than the target's own, which decides two things at the
  // drawing end: the card paints it differently (`object-fit: contain` on a tint, app/globals.css)
  // and wraps it in the `<picture>` that picks the dark file. It rides here rather than being
  // re-derived from `src`, because comparing a src against a constant to decide how to paint it is
  // the kind of derivation that survives exactly until the file is renamed.
  placeholder: boolean;
};

// The mark this blog shows where a picture would be, in its two schemes. Static files rather than
// uploads: this is site furniture, not content, so it must not appear to `gc-uploads.mts` as a
// referenced upload, and it has to resolve on a page that renders before any database is consulted.
//
// **Two files and a `<picture>`, not one file that knows about colour schemes.** The mark is the
// site's name in the foreground colour — black on the light tint, near-white on the dark one — so
// the wrong one is not "slightly off", it is invisible. An SVG's own `prefers-color-scheme` is
// honoured by Chrome (measured 2026-08-22) and by nothing this repo has a browser to measure;
// `<source media="(prefers-color-scheme: dark)">` is evaluated by the page itself, which is the
// same mechanism every other rule in app/globals.css already relies on (§17.3).
export const CARD_PLACEHOLDER_SRC = '/link-card-placeholder.svg';
export const CARD_PLACEHOLDER_DARK_SRC = '/link-card-placeholder-dark.svg';

// A card pointing at one of this blog's own posts. **It always has a picture**: a post with neither
// a chosen thumbnail nor an image in its body gets the site's mark instead of nothing (§17), which
// is the one shape of card that used to be three lines of text in a 136px frame (§16.2 is now the
// external-only case).
export function internalCardImage(thumbnail: string | null): CardImage {
  return thumbnail === null
    ? { src: CARD_PLACEHOLDER_SRC, placeholder: true }
    : { src: thumbnail, placeholder: false };
}

// A card pointing anywhere else. **No fallback here** — the house mark on an external card would
// say this blog is the source of a page it did not write, and the target's own icon is the thing
// §14.4 and `link-requirements.md` §5.5.8 refuse to put in front of a reader. An external target
// with no og:image keeps the text-only card (§16.2).
export function externalCardImage(src: string | null): CardImage | null {
  return src === null ? null : { src, placeholder: false };
}
