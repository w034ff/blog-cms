import { formatPostDate } from '@/lib/format';

// The deadline and the date shown for a withdrawal (docs/multi-author-requirements.md §12.2). One
// place, so the confirmation, the withdrawal page, the users screen and the purge cannot disagree.
// No `server-only`: the E2E harness builds rows with it.

// How many whole days a withdrawing author has to change their mind.
export const WITHDRAWAL_GRACE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
// Japan has no daylight saving time, so a fixed offset is the Asia/Tokyo calendar.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// Midnight JST at the end of the last day that can still be cancelled: the request's JST day plus
// WITHDRAWAL_GRACE_DAYS + 1. A whole day rather than 30 × 24 hours from the request, so the date on
// screen is cancellable all day.
export function withdrawalDueAt(requestedAt: Date): Date {
  const jstDayStart = Math.floor((requestedAt.getTime() + JST_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(jstDayStart + (WITHDRAWAL_GRACE_DAYS + 1) * DAY_MS - JST_OFFSET_MS);
}

// The last cancellable day, `2026年11月18日`: the JST day before the deadline.
export function withdrawalLastDay(dueAt: string): string {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return '';
  return formatPostDate(new Date(due.getTime() - 1).toISOString());
}
