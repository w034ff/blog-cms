import { describe, expect, it } from 'vitest';
import { WITHDRAWAL_GRACE_DAYS, withdrawalDueAt, withdrawalLastDay } from './withdrawal-rules';

describe('withdrawal deadline (docs/multi-author-requirements.md §12.2)', () => {
  it('is midnight JST, 31 days after the JST day of the request', () => {
    expect(WITHDRAWAL_GRACE_DAYS).toBe(30);
    // 2026-10-19 15:00 JST.
    const due = withdrawalDueAt(new Date('2026-10-19T06:00:00Z'));
    expect(due.toISOString()).toBe('2026-11-18T15:00:00.000Z'); // 2026-11-19 00:00 JST
    expect(withdrawalLastDay(due.toISOString())).toBe('2026年11月18日');
  });

  it('takes the JST day, not the UTC one, at either end of it', () => {
    // 2026-10-19 00:00 JST is still 10-18 in UTC.
    expect(withdrawalDueAt(new Date('2026-10-18T15:00:00Z')).toISOString()).toBe(
      '2026-11-18T15:00:00.000Z',
    );
    // 2026-10-19 23:59:59 JST.
    expect(withdrawalDueAt(new Date('2026-10-19T14:59:59Z')).toISOString()).toBe(
      '2026-11-18T15:00:00.000Z',
    );
    // 2026-10-20 00:00 JST moves the deadline a day.
    expect(withdrawalDueAt(new Date('2026-10-19T15:00:00Z')).toISOString()).toBe(
      '2026-11-19T15:00:00.000Z',
    );
  });
});
