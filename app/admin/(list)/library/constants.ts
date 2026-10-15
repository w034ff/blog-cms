import type { LibraryTab } from '@/lib/admin-post-list';

// Tab labels in order (docs/library-requirements.md §6.2).
export const TAB_LABEL_BOOKMARKS = 'ブックマーク';
export const TAB_LABEL_LIKES = 'いいね';
export const TAB_LABEL_HISTORY = '閲覧履歴';

export const TAB_LABELS: Record<LibraryTab, string> = {
  bookmarks: TAB_LABEL_BOOKMARKS,
  likes: TAB_LABEL_LIKES,
  history: TAB_LABEL_HISTORY,
};

// Toggle button aria-labels for unmarking and remarking.
export const ARIA_LABEL_BOOKMARK_REMOVE = 'ブックマークを外す';
export const ARIA_LABEL_BOOKMARK_RESTORE = 'ブックマークし直す';
export const ARIA_LABEL_LIKE_REMOVE = 'いいねを外す';
export const ARIA_LABEL_LIKE_RESTORE = 'いいねし直す';
