import { describe, expect, it } from 'vitest';
import { hasVisibleUpdate } from '@/lib/format';

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
