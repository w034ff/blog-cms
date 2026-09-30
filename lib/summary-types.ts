// The one definition of the まとめ and TL;DR blocks' stored class names and chrome, shared by the
// editor (client), the render pipeline and the excerpt (server) — keep this module importable from
// both sides (no 'server-only'), as lib/callout-types.ts is.
//
// The stored form carries only the four container classes (docs/summary-requirements.md §3.3); the
// labels, and the wrappers the two surfaces draw them in, are chrome that the NodeView and
// lib/rehype-summary.ts add. app/globals.css paints both and cannot import this, so a renamed class
// is still a hand edit there.

export const SUMMARY_CLASS = 'summary';
export const SUMMARY_GOOD_CLASS = 'summary-good';
export const SUMMARY_BAD_CLASS = 'summary-bad';
export const TLDR_CLASS = 'tldr';

// What lib/render.ts lets through on a <div>: an unlisted class is stripped silently, and the block
// would publish as a bare div.
export const SUMMARY_DIV_CLASSES = [
  SUMMARY_CLASS,
  SUMMARY_GOOD_CLASS,
  SUMMARY_BAD_CLASS,
  TLDR_CLASS,
] as const;

// Chrome, never stored: the block's title row, the column its content sits in, and the same pair
// for each section.
export const SUMMARY_LABEL_CLASS = 'summary-label';
export const SUMMARY_BODY_CLASS = 'summary-body';
export const SUMMARY_SECTION_LABEL_CLASS = 'summary-section-label';
export const SUMMARY_SECTION_BODY_CLASS = 'summary-section-body';

export const SUMMARY_TITLE = 'まとめ';
export const TLDR_TITLE = 'TL;DR';

export type SummarySectionKind = 'good' | 'bad';

export const SUMMARY_SECTION_TITLES: Record<SummarySectionKind, string> = {
  good: '良かった点',
  bad: '気になった点',
};

export const SUMMARY_SECTION_CLASSES: Record<SummarySectionKind, string> = {
  good: SUMMARY_GOOD_CLASS,
  bad: SUMMARY_BAD_CLASS,
};
