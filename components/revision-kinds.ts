import type { RevisionReason } from '@/lib/revisions';

// The colours of a revision's kind (docs/revision-requirements.md §5), shared by the history list's
// badges and the preview banner's left edge so the two cannot drift apart: a version readers saw
// in green, the safety copy a restore left in grey, and the pending-edits state in the sky
// 記事一覧 uses for it (app/admin/(list)/page.tsx). The banner keeps its own sky ground — that is
// what says "this is a preview" — and carries the kind on its edge alone, with no words: the
// author opened it from the list, which named it.

export type RevisionKind = {
  label: string;
  badge: string;
  // A left border colour, dark mode included: the banner's `dark:border-*` would otherwise
  // recolour all four sides.
  accent: string;
};

export const REVISION_KINDS: Record<RevisionReason, RevisionKind> = {
  publish: {
    label: '以前の公開記事',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    accent: 'border-l-emerald-500 dark:border-l-emerald-500',
  },
  restore: {
    label: '復元する前',
    badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    accent: 'border-l-zinc-400 dark:border-l-zinc-500',
  },
};

export const PENDING_EDITS_KIND: RevisionKind = {
  label: '未公開の変更',
  badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  accent: 'border-l-sky-600 dark:border-l-sky-400',
};
