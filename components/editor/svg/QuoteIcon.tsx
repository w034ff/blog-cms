// Blockquote glyph: a pair of quotation marks — the near-universal "quote" mark, and clearly
// distinct from the neighbouring list icon (the reason this isn't a bar+lines shape). Drawn
// filled (fill='currentColor'), since a quote mark reads best as a solid shape at 16px. A solid
// glyph would otherwise sit heavier than the thin-stroke icons beside it, so it's scaled to ~0.9
// about the centre — same shape, more surrounding whitespace, so its weight matches the row.
export function QuoteIcon() {
  return (
    <svg viewBox='0 0 24 24' className='block h-4 w-4' fill='currentColor' aria-hidden='true'>
      <g transform='translate(12 12) scale(0.9) translate(-12 -12)'>
        <path d='M5 17h3l2-4V7H4v6h3zm10 0h3l2-4V7h-6v6h3z' />
      </g>
    </svg>
  );
}
