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

// A scribble's timeline date (docs/scribble-requirements.md §5): two tiers, year on top and
// month/day below, in JST.
const SCRIBBLE_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tokyo',
};

export function formatScribbleDate(value: string): { year: string; monthDay: string } {
  if (!value) return { year: '', monthDay: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { year: '', monthDay: value };
  const parts = new Intl.DateTimeFormat('ja-JP', SCRIBBLE_DATE_OPTIONS).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return { year, monthDay: `${month}/${day}` };
}

// A scribble page's date, `2026-10-14`: the same JST day as the timeline's, written whole.
export function formatScribbleDayIso(value: string): string {
  const { year, monthDay } = formatScribbleDate(value);
  return year ? `${year}-${monthDay.replace('/', '-')}` : '';
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

// The year only when it is not this one (JST): a post's revisions almost always share it, and on
// every row it is the same four digits pushing the badge and title to the right. `now` is a
// parameter so the boundary can be tested.
const YEAR_ONLY: Intl.DateTimeFormatOptions = { year: 'numeric', timeZone: 'Asia/Tokyo' };
const DATE_TIME_WITHOUT_YEAR: Intl.DateTimeFormatOptions = {
  month: DATE_TIME_OPTIONS.month,
  day: DATE_TIME_OPTIONS.day,
  hour: DATE_TIME_OPTIONS.hour,
  minute: DATE_TIME_OPTIONS.minute,
  timeZone: DATE_TIME_OPTIONS.timeZone,
};

export function formatRevisionTime(epochMs: number, now: number = Date.now()): string {
  const date = new Date(epochMs);
  const sameYear =
    date.toLocaleString('ja-JP', YEAR_ONLY) === new Date(now).toLocaleString('ja-JP', YEAR_ONLY);
  return date.toLocaleString('ja-JP', sameYear ? DATE_TIME_WITHOUT_YEAR : DATE_TIME_OPTIONS);
}

// How long ago, for 記事一覧's last edit: what the list is read for is "how recently did I touch
// this", not the minute. Coarser with age, and past RELATIVE_DAYS_MAX a date (the year only when it
// is not this one, as formatRevisionTime does). `now` is a parameter so the boundaries can be tested.
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_DAYS_MAX = 30;
const DATE_WITHOUT_YEAR: Intl.DateTimeFormatOptions = {
  month: DATE_OPTIONS.month,
  day: DATE_OPTIONS.day,
  timeZone: DATE_OPTIONS.timeZone,
};

export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - epochMs);
  if (elapsed < MINUTE_MS) return 'たった今';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分前`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 時間前`;
  if (elapsed < RELATIVE_DAYS_MAX * DAY_MS) return `${Math.floor(elapsed / DAY_MS)} 日前`;
  const date = new Date(epochMs);
  const sameYear =
    date.toLocaleString('ja-JP', YEAR_ONLY) === new Date(now).toLocaleString('ja-JP', YEAR_ONLY);
  return date.toLocaleString('ja-JP', sameYear ? DATE_WITHOUT_YEAR : DATE_OPTIONS);
}

// The editor's 文字数 (docs/editor-requirements.md §12.38): characters of the body's text without
// whitespace, so a blank line or an indent counts nothing. Code points, not UTF-16 units, so an
// emoji outside the BMP is one.
export function countChars(text: string): number {
  let n = 0;
  for (const ch of text) if (!/\s/u.test(ch)) n += 1;
  return n;
}

export function formatCharCount(n: number): string {
  return `${n.toLocaleString('en-US')} 字`;
}
