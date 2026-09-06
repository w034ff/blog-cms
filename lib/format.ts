// Render a post's stored publish date as a Japanese date (and optionally time)
// in JST.
//
// `date` is a UTC ISO timestamp captured at first publish. The site is
// Japan-facing, so the public date is always the Asia/Tokyo calendar date —
// pinned explicitly here so it doesn't depend on the server's timezone or where
// the author happened to publish from. Both helpers return '' for an unset date
// (a never-published draft, stored as '') and echo back anything unparseable.

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Tokyo',
};

// Date plus 24-hour 時:分 — used in the admin list where the exact publish moment
// is useful for management. Public pages stay date-only by convention.
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
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

export function formatPostDateTime(value: string): string {
  return format(value, DATE_TIME_OPTIONS);
}

// Whether a post's update date is worth showing next to its publish date — only
// when they name a different calendar day (JST). Comparing the formatted strings
// rather than the raw timestamps reuses the same day boundary `formatPostDate`
// already draws, instead of a second timezone calculation that could disagree
// with it.
export function hasVisibleUpdate(date: string, updatedAt: string): boolean {
  return formatPostDate(date) !== formatPostDate(updatedAt);
}
