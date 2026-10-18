// The longest body a write path accepts (docs/abuse-limits-requirements.md §3, §7). Shared with the
// editor, which words its refusal from the same number.
export const BODY_MAX_CHARS = 100_000;

// What autosave answers an over-long body with (app/api/drafts/route.ts); the editor reads the
// status, never this string.
export const BODY_TOO_LONG_STATUS = 413;
export const BODY_TOO_LONG_ERROR = 'body too long';

// The editor's 保存に失敗 line when autosave is refused for length. Four characters: beside a
// six-digit 文字数 the touch header at 360px keeps one row only up to four
// (docs/abuse-limits-requirements.md §7), so the limit itself goes in the hover title.
export const BODY_TOO_LONG_NOTICE = '字数超過';
export const BODY_TOO_LONG_TITLE = `本文は ${formatCount(BODY_MAX_CHARS)} 字までです`;

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

// Code points, not UTF-16 units: an emoji is one character to the author.
export function bodyLength(body: string): number {
  return body.length - (body.match(SURROGATE_PAIR)?.length ?? 0);
}

// A string of at most BODY_MAX_CHARS units has at most that many code points, so the pairs are
// counted only for a body already near or over the limit.
export function isBodyTooLong(body: string): boolean {
  return body.length > BODY_MAX_CHARS && bodyLength(body) > BODY_MAX_CHARS;
}

// The publish form's refusal. It carries the count so the author knows how much to cut.
export function bodyTooLongMessage(body: string): string {
  return `本文が長すぎます。${formatCount(BODY_MAX_CHARS)} 字までにしてください（今は ${formatCount(bodyLength(body))} 字）。`;
}
