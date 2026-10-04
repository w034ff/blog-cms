// A framed title row with its own disclosure triangle, divided from the (collapsed) body below —
// the `<details>`/`<summary>` shape this inserts, in the same stroke style as the row's other
// icons. The triangle mirrors the published marker's own shape (docs/accordion-requirements.md).
export function AccordionIcon() {
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
      <rect x='3' y='4' width='18' height='16' rx='2' />
      <path d='M6.5 7.5l3 2-3 2z' fill='currentColor' stroke='none' />
      <line x1='12' y1='9.5' x2='18' y2='9.5' />
      <line x1='3' y1='13' x2='21' y2='13' />
    </svg>
  );
}
