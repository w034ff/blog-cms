// Two lines of body text, a long one over a short one — no numeral (tried twice: a lone "1" read
// fine but sat oddly alone, a "1" beside a second line read as an equals sign at 16px,
// screenshot-compared 2026-09-20). The row's own label carries "footnote"; the glyph is a generic
// note/text mark, the same division of labour 引用's quote-mark icon has (labelled, not literal).
export function FootnoteIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <line x1='3' y1='9' x2='21' y2='9' />
      <line x1='3' y1='15' x2='13' y2='15' />
    </svg>
  );
}
