// Render a post's stored publish date as a Japanese date in JST.
//
// `date` is a UTC ISO timestamp captured at first publish. The site is
// Japan-facing, so the displayed date is always the Asia/Tokyo calendar date —
// pinned explicitly here so it doesn't depend on the server's timezone or where
// the author happened to publish from. Returns '' for an unset date (a
// never-published draft, stored as '') and echoes back anything unparseable.

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Tokyo',
};

function format(value: string, options: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ja-JP', options);
}

export function formatPostDate(value: string): string {
  return format(value, DATE_OPTIONS);
}

// Whether a post's update date is worth showing next to its publish date — only
// when they name a different calendar day (JST). Comparing the formatted strings
// rather than the raw timestamps reuses the same day boundary `formatPostDate`
// already draws, instead of a second timezone calculation that could disagree
// with it.
export function hasVisibleUpdate(date: string, updatedAt: string): boolean {
  if (!date) return false;
  return formatPostDate(date) !== formatPostDate(updatedAt);
}

// A revision's moment (docs/revision-requirements.md §5): date and minute in JST. The minute is
// the point — several revisions of one post routinely share a day.
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: '2-digit',
  minute: '2-digit',
};

export function formatRevisionTime(epochMs: number): string {
  return format(new Date(epochMs).toISOString(), DATE_TIME_OPTIONS);
}
