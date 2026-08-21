// The geometry of the editor's icons, as data.
//
// It lives apart from the components in this directory because it has two consumers that cannot
// share code: the React icons here, and the link card's NodeView (link-card-extension.ts), which
// builds plain DOM and so cannot render JSX. Duplicating the paths there is what this avoids —
// the shapes below were tuned against how they read at 16px (see UnlinkIcon's note), and a second
// copy would drift away from that the first time one of them is adjusted.
export type IconShape =
  | { readonly kind: 'path'; readonly d: string }
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

// A box with an arrow leaving it — "open elsewhere". The box is drawn as one open path with its
// top-right corner missing, so the arrow leaves through the gap instead of crossing a line: at
// 16px a crossing there fills in and the two shapes read as one blob.
export const EXTERNAL_LINK_SHAPES: readonly IconShape[] = [
  { kind: 'path', d: 'M14 4h6v6' },
  { kind: 'line', x1: 20, y1: 4, x2: 11, y2: 13 },
  { kind: 'path', d: 'M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5' },
];

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
      svg.appendChild(path);
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
