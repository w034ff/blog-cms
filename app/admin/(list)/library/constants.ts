import type { LibraryTab } from '@/lib/admin-post-list';
import type { PostKind } from '@/lib/content';

// Tab labels in order (docs/library-requirements.md §6.2).
export const TAB_LABEL_BOOKMARKS = 'ブックマーク';
export const TAB_LABEL_LIKES = 'いいね';
export const TAB_LABEL_HISTORY = '閲覧履歴';

export const TAB_LABELS: Record<LibraryTab, string> = {
  bookmarks: TAB_LABEL_BOOKMARKS,
  likes: TAB_LABEL_LIKES,
  history: TAB_LABEL_HISTORY,
};

// Kind badges (docs/library-requirements.md §6.2).
export const KIND_LABEL_POST = '記事';
export const KIND_LABEL_SCRIBBLE = '走り書き';

export const KIND_LABELS: Record<PostKind, string> = {
  post: KIND_LABEL_POST,
  scribble: KIND_LABEL_SCRIBBLE,
};

// Prefixes before relative mark / view times.
export const AT_PREFIX_BOOKMARK = '保存 ';
export const AT_PREFIX_LIKE = 'いいね ';
export const AT_PREFIX_HISTORY = '閲覧 ';

export const AT_PREFIXES: Record<LibraryTab, string> = {
  bookmarks: AT_PREFIX_BOOKMARK,
  likes: AT_PREFIX_LIKE,
  history: AT_PREFIX_HISTORY,
};

// Toggle button aria-labels for unmarking and remarking.
export const ARIA_LABEL_BOOKMARK_REMOVE = 'ブックマークを外す';
export const ARIA_LABEL_BOOKMARK_RESTORE = 'ブックマークし直す';
export const ARIA_LABEL_LIKE_REMOVE = 'いいねを外す';
export const ARIA_LABEL_LIKE_RESTORE = 'いいねし直す';
