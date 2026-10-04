import { describe, expect, it } from 'vitest';
import {
  countChars,
  formatCharCount,
  formatRelativeTime,
  formatRevisionTime,
  hasVisibleUpdate,
} from '@/lib/format';

describe('hasVisibleUpdate', () => {
  it('is false when the two timestamps land on the same JST calendar day', () => {
    expect(hasVisibleUpdate('2026-09-06T01:00:00.000Z', '2026-09-06T10:00:00.000Z')).toBe(false);
  });

  it('is true once the update lands on a later JST calendar day', () => {
    expect(hasVisibleUpdate('2026-09-04T01:00:00.000Z', '2026-09-06T01:00:00.000Z')).toBe(true);
  });

  // JST is UTC+9 with no DST, so a UTC timestamp just before/after 15:00 can fall
  // on different JST calendar days despite being minutes apart — the case a raw
  // UTC-date-string comparison would get wrong.
  it('treats a UTC-day-boundary crossing correctly via the JST calendar day', () => {
    expect(hasVisibleUpdate('2026-09-05T14:59:00.000Z', '2026-09-05T15:01:00.000Z')).toBe(true);
  });
});

describe('formatRevisionTime', () => {
  const now = Date.parse('2026-09-22T10:00:00Z');

  it('drops the year within the current JST year', () => {
    expect(formatRevisionTime(Date.parse('2026-09-22T10:15:00Z'), now)).toBe('9月22日 19:15');
  });

  it('keeps it for an earlier year, deciding the year in JST rather than UTC', () => {
    expect(formatRevisionTime(Date.parse('2025-12-03T01:00:00Z'), now)).toBe('2025年12月3日 10:00');
    // 2025-12-31T15:30Z is already 2026-01-01 in Tokyo.
    expect(formatRevisionTime(Date.parse('2025-12-31T15:30:00Z'), now)).toBe('1月1日 00:30');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const ago = (ms: number) => formatRelativeTime(now - ms, now);

  it('counts minutes, hours and days, each up to the next unit', () => {
    expect(ago(30_000)).toBe('たった今');
    expect(ago(60_000)).toBe('1 分前');
    expect(ago(59 * 60_000)).toBe('59 分前');
    expect(ago(60 * 60_000)).toBe('1 時間前');
    expect(ago(23 * 3_600_000)).toBe('23 時間前');
    expect(ago(24 * 3_600_000)).toBe('1 日前');
    expect(ago(29 * 86_400_000)).toBe('29 日前');
  });

  it('gives a date from 30 days on, with the year only when it is not this one (JST)', () => {
    expect(ago(30 * 86_400_000)).toBe('9月4日');
    expect(formatRelativeTime(Date.parse('2025-12-03T01:00:00Z'), now)).toBe('2025年12月3日');
  });

  it('reads a moment ahead of now (a skewed clock) as just now', () => {
    expect(formatRelativeTime(now + 5_000, now)).toBe('たった今');
  });
});

describe('countChars', () => {
  it('counts characters without whitespace', () => {
    expect(countChars('日本語 の\n本文\t です')).toBe(8);
    expect(countChars('   \n\n')).toBe(0);
    expect(countChars('')).toBe(0);
  });
  it('counts an emoji outside the BMP as one', () => {
    expect(countChars('a😀b')).toBe(3);
  });
});

describe('formatCharCount', () => {
  it('groups thousands', () => {
    expect(formatCharCount(0)).toBe('0 字');
    expect(formatCharCount(12345)).toBe('12,345 字');
  });
});
