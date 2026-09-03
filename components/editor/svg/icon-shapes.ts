import { GITHUB_MARK_PATH } from '@/lib/github-mark';
import { X_PROVIDER } from '@/lib/embed-message';

// The geometry of the editor's icons, as data.
//
// It lives apart from the components in this directory because it has two consumers that cannot
// share code: the React icons here, and the link card's NodeView (link-card-extension.ts), which
// builds plain DOM and so cannot render JSX. Duplicating the paths there is what this avoids —
// the shapes below were tuned against how they read at 16px (see UnlinkIcon's note), and a second
// copy would drift away from that the first time one of them is adjusted.
export type IconShape =
  // `filled` is for a shape that is a solid area rather than a stroke — a play triangle inside a
  // stroked frame, say. The svg's own attributes stay stroke-first (see `buildIcon`), so a filled
  // shape overrides them for itself.
  | { readonly kind: 'path'; readonly d: string; readonly filled?: boolean }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
    }
  | {
      readonly kind: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    };

// Pencil on a diagonal — "edit". The nib is a separate short stroke so the tip still reads as a
// point at 16px, where the two body strokes are only about two pixels apart.
export const PENCIL_SHAPES: readonly IconShape[] = [
  { kind: 'path', d: 'M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4z' },
  { kind: 'line', x1: 14.5, y1: 5.5, x2: 18.5, y2: 9.5 },
];

// A horizontal chain with a slash across it — "remove the link".
//
// The two shapes both carry the message and they have to be drawn so as not to fight each other at
// 16px. The chain is horizontal: a diagonal break was tried first and, in the destructive red, read
// as a question mark (measured, both schemes) — the halves have to sit on a level baseline to be
// recognised as a chain at all. The arcs and the connecting bar are then trimmed short of the
// slash's path rather than run under it, so the crossing stays two strokes wide instead of four.
export const UNLINK_SHAPES: readonly IconShape[] = [
  { kind: 'path', d: 'M9 17H7A5 5 0 0 1 7 7' },
  { kind: 'path', d: 'M15 7h2a5 5 0 0 1 4 8' },
  { kind: 'line', x1: 8, y1: 12, x2: 12, y2: 12 },
  { kind: 'line', x1: 2, y1: 2, x2: 22, y2: 22 },
];

// A leftward arrow — "back to what this replaced". The link card's picker uses it for 「キャンセル」
// (link-card-extension.ts): not the X monogram above (a brand mark, not a close glyph) and not a
// bare ✕, which would sit one control away from 「変更」/「リンクに戻す」 and risk the confusion an
// icon-only 取り消し already caused once next to 解除 (LinkBubble.tsx).
export const BACK_SHAPES: readonly IconShape[] = [
  { kind: 'line', x1: 19, y1: 12, x2: 5, y2: 12 },
  { kind: 'path', d: 'M11 5l-7 7 7 7' },
];

// A box with an arrow leaving it — "open elsewhere". The box is drawn as one open path with its
// top-right corner missing, so the arrow leaves through the gap instead of crossing a line: at
// 16px a crossing there fills in and the two shapes read as one blob.
export const EXTERNAL_LINK_SHAPES: readonly IconShape[] = [
  { kind: 'path', d: 'M14 4h6v6' },
  { kind: 'line', x1: 20, y1: 4, x2: 11, y2: 13 },
  { kind: 'path', d: 'M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5' },
];

// A framed block with a play triangle in it — the embed as it is drawn on the published page
// (lib/rehype-embed.ts), so a button showing it names what it produces rather than describing it.
// The sibling of CardIcon, and deliberately the same frame: the two occupy the same slot and differ
// only in what fills it. The default mark for a provider with no mark of its own.
export const PLAY_SHAPES: readonly IconShape[] = [
  { kind: 'rect', x: 3, y: 5, width: 18, height: 14, rx: 2 },
  { kind: 'path', d: 'M10.5 9.5l4.5 2.5-4.5 2.5z', filled: true },
];

// The same frame as `PLAY_SHAPES`, filled with two content lines instead of a play triangle —
// Docswell's mark (embed-requirements.md §17.7) until 2026-09-03, when their terms turned up a
// requirement to ask permission before using it on an external site, which this repo has not done.
// A play triangle reads as video, which `docswell`'s kind ("スライド") is not, so this draws the
// generic shape of a slide rather than falling back to `PLAY_SHAPES`.
export const SLIDE_SHAPES: readonly IconShape[] = [
  { kind: 'rect', x: 3, y: 5, width: 18, height: 14, rx: 2 },
  { kind: 'line', x1: 7, y1: 10, x2: 15, y2: 10 },
  { kind: 'line', x1: 7, y1: 14, x2: 12, y2: 14 },
];

// The X monogram (docs/embed-requirements.md §7.3). The one mark here that is a brand's rather than
// a drawn shape, and the one with no frame: at 16px a frame leaves about 5 rendered pixels for what
// sits inside it, which is not enough for a letterform. **Drawn filled** — under this file's usual
// attributes the path is a hollow outline of the letter, which at this size is a blot.
export const X_MARK_SHAPES: readonly IconShape[] = [
  {
    kind: 'path',
    d: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
    filled: true,
  },
];

// SlideShare's own mark, taken as published rather than re-derived, for SPEAKERDECK_MARK_SHAPES'
// reason (embed-requirements.md §14.8). The source is the glyph inside `favicon.*.svg` on
// SlideShare's CDN — the badge's orange disc is dropped, since the disc is a container rather than
// the mark and no other mark here carries one.
//
// **One colour costs this mark nothing**: the inner panel is published as a counter — a reversed
// subpath inside the same `d` — so it is a hole in the fill rather than a second colour, and the
// two overlapping panels still read as two at 16px (compared against the badge and against the
// stroked screen it replaces, 16/24/40px in both schemes, 2026-08-26).
//
// Fitted like the other brand marks: the glyph is 109×86 in the favicon's units, scaled to a 21.5
// span by width and centred in the 24 box, landing at 21.5×16.96. The transform is baked into the
// coordinates because an IconShape carries no transform; rounding to 2 decimals was diffed against
// the un-baked render and differs in 0 pixels at 16, 24 and 40px.
export const SLIDESHARE_MARK_SHAPES: readonly IconShape[] = [
  {
    kind: 'path',
    d: 'M21.43 3.52H8.39C7.66 3.52 7.07 4.12 7.07 4.85V7.73C7.07 8.46 6.48 9.06 5.75 9.06H2.57C1.84 9.06 1.25 9.66 1.25 10.39V19.15C1.25 19.88 1.84 20.48 2.57 20.48H15.65C16.38 20.48 16.97 19.88 16.97 19.15V16.27C16.97 15.54 17.56 14.94 18.29 14.94H21.43C22.16 14.94 22.75 14.34 22.75 13.61V4.85C22.75 4.12 22.16 3.52 21.43 3.52H21.43ZM16.47 14.27C16.47 14.64 16.18 14.94 15.81 14.94H8.19C7.82 14.94 7.53 14.64 7.53 14.27V9.73C7.53 9.36 7.82 9.06 8.19 9.06H15.81C16.18 9.06 16.47 9.36 16.47 9.73V14.27Z',
    filled: true,
  },
];

// The Figma logo (embed-requirements.md §7.3, §15.7). The second mark here that is a brand's rather
// than a drawn shape, and the second drawn **filled** — for X_MARK_SHAPES' reason, inverted: that
// one is filled because a hollow letterform is a blot at 16px, and this one because the logo is
// five solid shapes to begin with.
//
// The 1.2-unit gaps are the measurement (2026-08-25, rendered at 16px against the alternatives).
// Without them the five shapes merge into one silhouette — the colours are what separate them in
// the original, and this file has one colour. With them the F still reads on a 1x screen, where
// the gaps are under a pixel and blur back into that same silhouette: the fallback is the shape it
// would have had anyway.
//
// Geometry rather than a copied path, so it can be re-derived: three left-column shapes rounded on
// the left (x 8.6–11.4), one top-right rounded on the right, and a circle at the middle right, on a
// 3-row grid of r = 3.4 (measured off the logo as Figma draws it in the embed's own footer).
export const FIGMA_MARK_SHAPES: readonly IconShape[] = [
  { kind: 'path', d: 'M11.4 2.6H8.6a3.4 3.4 0 0 0 0 6.8h2.8z', filled: true },
  { kind: 'path', d: 'M12.6 2.6h2.8a3.4 3.4 0 0 1 0 6.8h-2.8z', filled: true },
  { kind: 'path', d: 'M11.4 9.6H8.6a3.4 3.4 0 0 0 0 6.8h2.8z', filled: true },
  { kind: 'path', d: 'M12.6 12a3.4 3.4 0 1 1 6.8 0 3.4 3.4 0 0 1-6.8 0z', filled: true },
  { kind: 'path', d: 'M11.4 16.6H8.6a3.4 3.4 0 0 0 0 6.8h2.8z', filled: true },
];

// The Speaker Deck monogram (embed-requirements.md §16.7). The third mark here that is a brand's
// rather than a drawn shape, and the third drawn **filled** — the glyph is a solid shape to begin
// with, as Figma's five are.
//
// **Speaker Deck's own mark, re-fitted rather than re-derived.** Figma's note explains why that one
// is geometry: five circles and rounded rectangles can be written down and checked. This is two
// letterforms whose curves are the typeface's, and a re-derivation would be a drawing of the logo
// rather than the logo — X_MARK_SHAPES is the precedent for taking the path as published.
//
// The refit is one number: the published mark is 32×20, and scaling it to 24 wide makes it heavier
// at 16px than the two marks beside it, which span about 21.5. So it is scaled to that span instead
// and centred in the 24 box (measured 2026-08-26, rendered at 16/24/40px against X and Figma in
// both schemes). The source is `mark-*.svg` on Speaker Deck's own CDN, translated out of its
// `translate(-41,-25)` group.
export const SPEAKERDECK_MARK_SHAPES: readonly IconShape[] = [
  {
    kind: 'path',
    d: 'M10.23,13.68L5.45,13.68C3.13,13.68,1.25,11.8,1.25,9.48C1.25,7.16,3.13,5.28,5.45,5.28L11.03,5.28C11.96,5.28,12.71,6.03,12.71,6.96C12.71,7.89,11.96,8.64,11.03,8.64L5.36,8.64C4.9,8.64,4.52,9.02,4.52,9.48C4.52,9.94,4.9,10.32,5.36,10.32L10.14,10.32C12.46,10.32,14.34,12.2,14.34,14.52C14.34,16.84,12.46,18.72,10.14,18.72L2.93,18.72C2,18.72,1.25,17.97,1.25,17.04C1.25,16.11,2,15.36,2.93,15.36L10.23,15.36C10.69,15.36,11.07,14.98,11.07,14.52C11.07,14.06,10.69,13.68,10.23,13.68ZM13.76,18.72C14.88,17.96,15.68,16.76,15.91,15.36L18.62,15.36C19.08,15.36,19.45,14.98,19.45,14.52L19.45,9.48C19.45,9.02,19.08,8.64,18.62,8.64L13.7,8.64C14.09,8.19,14.33,7.61,14.33,6.96C14.33,6.32,14.09,5.73,13.7,5.28L19.45,5.28C21.27,5.28,22.75,6.79,22.75,8.64L22.75,15.36C22.75,17.21,21.27,18.72,19.45,18.72L13.76,18.72Z',
    filled: true,
  },
];

// GitHub's own mark. The path itself is `lib/github-mark.ts` — the published code-block header
// draws the same one, and only `lib/` is importable from both sides (§19.4).
export const GITHUB_MARK_SHAPES: readonly IconShape[] = [
  {
    kind: 'path',
    d: GITHUB_MARK_PATH,
    filled: true,
  },
];

// **A post is not something that plays**, so the mark for an embed is the provider's question, not
// one picture for all of them (§7.3). One place answers it, because the bubble's button and the
// drag ghost both ask — and a provider added to `lib/embed-provider.ts` with a mark given to only
// one of them is the drift this avoids.
//
// The providers are named by their `EmbedTarget.provider` string. `X_PROVIDER` is imported because
// `lib/embed-message.ts` already has to name X for the protocol it speaks; SlideShare has no such
// constant to borrow, and inventing one there would put a name in a file about postMessage for a
// provider that never sends one.
// CodeSandbox's square ring (docs/embed-requirements.md §20.10). **The closest-sourced mark here**:
// it is not lifted off a brand page but out of the document CodeSandbox serves at `/embed/<id>`
// itself, which carries the favicon inline as
// `<svg viewBox='0 0 100 100'><path fill-rule='evenodd' d='M81.8182 18.1818V81.8182H18.1818V18.1818H81.8182ZM10 90V10H90V90H10Z'/></svg>`
// (read 2026-08-30).
//
// That is an even-odd fill of two nested squares; an `IconShape` is stroke-first, so the ring is
// re-expressed as its centreline. Outer edge 10 and inner edge 18.1818 in a 100 box put the
// centreline at 14.0909, which scales to 3.38 with a 17.24 span in the 24 box. The ring's own width
// (8.1818, i.e. 1.9636 at this scale) is within 2% of the `stroke-width: 2` that `buildIcon` and
// the React icons already set, so **the line weight is the icon set's rather than the brand's** and
// the difference does not reach a pixel at any size drawn here.
export const CODESANDBOX_MARK_SHAPES: readonly IconShape[] = [
  { kind: 'rect', x: 3.38, y: 3.38, width: 17.24, height: 17.24, rx: 0 },
];

// CodePen's cube (docs/embed-requirements.md §21.10). The source is the pen page's own
// `<link rel="mask-icon">` — `cpwebassets.codepen.io/assets/favicon/logo-pin-<digest>.svg`, a
// single `<path>` in a `0 0 24.3 24.29` box (read 2026-08-31). **A mask-icon is monochrome by
// definition**, so unlike §17.7's Docswell there was no two-colour drawing to flatten: this is the
// published artwork, unaltered in shape.
//
// Only the frame around it is this project's. The path fills its own box edge to edge, which would
// make it the largest mark in the set and clip it against `buildIcon`'s `0 0 24` viewBox, so it is
// scaled by 21.5/24.3 and centred (`translate(1.25, 1.2555) scale(0.884774)`) — §17.7's 21.5 span,
// which puts it beside X's 21.3. **The transform is baked into the coordinates** because
// `IconShape` has none; the baked path was rendered against the same path under that `<g
// transform>` and is identical at 16px, with the larger sizes differing only where rounding to
// three decimals moves an antialiased edge.
//
// **Filled, and it needs no `fill-rule`.** The interior facets are wound against the outer hexagon,
// so nonzero and even-odd draw the same picture (compared at 240px); `IconSvg` sets no rule, and
// this is the shape that would have needed one.
export const CODEPEN_MARK_SHAPES: readonly IconShape[] = [
  {
    kind: 'path',
    filled: true,
    d: 'M 12 22.747 a 1.009 1.009 0 0 1 -0.575 -0.177 l -9.733 -6.441 a 0.805 0.805 0 0 1 -0.283 -0.265 h 0 l 0 -0.044 A 1.097 1.097 0 0 1 1.25 15.253 V 8.732 a 1.088 1.088 0 0 1 0.159 -0.557 l 0 -0.053 a 0.885 0.885 0 0 1 0.283 -0.257 L 11.425 1.424 a 1.079 1.079 0 0 1 1.15 0 l 9.733 6.441 a 0.885 0.885 0 0 1 0.283 0.257 h 0 a 0.088 0.088 0 0 1 0 0.044 1.088 1.088 0 0 1 0.159 0.557 v 6.521 a 1.097 1.097 0 0 1 -0.159 0.566 l 0 0.044 a 0.885 0.885 0 0 1 -0.283 0.265 l -9.733 6.441 A 1.009 1.009 0 0 1 12 22.747 Z m 1.017 -6.937 V 19.836 l 6.884 -4.574 -3.035 -2.044 Z M 4.099 15.261 10.983 19.836 V 15.81 L 7.134 13.218 Z m 4.857 -3.265 3.044 2.044 3.044 -2.044 L 12 9.944 Z m 9.733 0 L 20.715 13.359 V 10.634 Z M 3.285 10.634 v 2.725 l 2.026 -1.363 Z m 9.733 -2.451 3.849 2.584 3.035 -2.035 L 13.017 4.158 Z M 4.099 8.732 l 3.035 2.035 L 10.983 8.183 V 4.158 Z',
  },
];

export function embedMarkShapes(provider: string | undefined): readonly IconShape[] {
  if (provider === X_PROVIDER) return X_MARK_SHAPES;
  if (provider === 'codesandbox') return CODESANDBOX_MARK_SHAPES;
  if (provider === 'codepen') return CODEPEN_MARK_SHAPES;
  if (provider === 'slideshare') return SLIDESHARE_MARK_SHAPES;
  if (provider === 'speakerdeck') return SPEAKERDECK_MARK_SHAPES;
  if (provider === 'docswell') return SLIDE_SHAPES;
  if (provider === 'gist') return GITHUB_MARK_SHAPES;
  return provider === 'figma' ? FIGMA_MARK_SHAPES : PLAY_SHAPES;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// The DOM half, for callers outside React. The attributes match what the React icons carry, so the
// same shape drawn either way is the same picture: 24-unit box, no fill, `currentColor` stroke —
// which is what lets the link card's destructive control tint its icon by setting `color` alone.
// `aria-hidden` because every caller pairs the icon with a real name (a label, visible or not).
export function buildIcon(shapes: readonly IconShape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of shapes) {
    if (shape.kind === 'path') {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', shape.d);
      if (shape.filled) {
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('stroke', 'none');
      }
      svg.appendChild(path);
    } else if (shape.kind === 'rect') {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(shape.x));
      rect.setAttribute('y', String(shape.y));
      rect.setAttribute('width', String(shape.width));
      rect.setAttribute('height', String(shape.height));
      rect.setAttribute('rx', String(shape.rx));
      svg.appendChild(rect);
    } else {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(shape.x1));
      line.setAttribute('y1', String(shape.y1));
      line.setAttribute('x2', String(shape.x2));
      line.setAttribute('y2', String(shape.y2));
      svg.appendChild(line);
    }
  }
  return svg;
}
