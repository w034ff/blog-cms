// What an account's ID accepts (docs/multi-author-requirements.md §13.3). No `server-only` and no
// `@/` imports: the account form counts with it, and scripts/seed.mts and the E2E harness, which
// run under plain node, write the automatic value with it.

export const HANDLE_MAX_CHARS = 15;
const HANDLE_MIN_CHARS = 3;
const HANDLE_SHAPE = new RegExp(`^[a-z0-9_]{${HANDLE_MIN_CHARS},${HANDLE_MAX_CHARS}}$`);

// The automatic value's shape. No one may choose it, or an ID taken ahead of time would collide
// with the automatic value of the account that later gets that id.
const AUTOMATIC_SHAPE = /^user\d+$/;

// The site's own route names and names that claim to speak for it, kept free so an author page
// can put the ID in a URL without colliding (§13.3).
export const RESERVED_HANDLES: readonly string[] = [
  'admin',
  'api',
  'auth',
  'login',
  'logout',
  'posts',
  'scribbles',
  'tags',
  'categories',
  'search',
  'withdrawal',
  'uploads',
  'rss',
  'settings',
  'users',
  'account',
  'library',
  'root',
  'system',
  'support',
  'official',
];

export const HANDLE_FORMAT_ERROR = `英小文字・数字・_ の ${HANDLE_MIN_CHARS}〜${HANDLE_MAX_CHARS} 文字で入力してください`;
export const HANDLE_TAKEN = 'この ID はほかの利用者が使っています';
export const HANDLE_UNAVAILABLE = 'この ID は使えません';
export const HANDLE_FIXED = 'ID は変えられません。';

// The ID an account has until its owner chooses one, and the one read for a row that has none.
export function automaticHandle(userId: number): string {
  return `user${userId}`;
}

// Width, case and one leading @ do not make a different ID: ＹＡＭＡＤＡ and @yamada are yamada.
export function normalizeHandle(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase().replace(/^@/, '');
}

export type HandleCheck = { ok: true; value: string } | { ok: false; error: string };

// The rules that need no database: the shape, then the names no one may choose.
export function checkHandle(raw: string): HandleCheck {
  const value = normalizeHandle(raw);
  if (!HANDLE_SHAPE.test(value)) return { ok: false, error: HANDLE_FORMAT_ERROR };
  if (AUTOMATIC_SHAPE.test(value) || RESERVED_HANDLES.includes(value)) {
    return { ok: false, error: HANDLE_UNAVAILABLE };
  }
  return { ok: true, value };
}
