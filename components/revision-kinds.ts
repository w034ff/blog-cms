import type { RevisionReason } from '@/lib/revisions';

// The badges of a revision's kind on the history list (docs/revision-requirements.md §5): a
// version readers saw in green, the safety copy a restore left in grey, and the pending-edits
// state in the sky 記事一覧 uses for it (app/admin/(list)/page.tsx).

export type RevisionKind = {
  label: string;
  badge: string;
};

export const REVISION_KINDS: Record<RevisionReason, RevisionKind> = {
  publish: {
    label: '以前の公開記事',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  restore: {
    label: '復元する前',
    badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
};

export const PENDING_EDITS_KIND: RevisionKind = {
  label: '未公開の変更',
  badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
};
