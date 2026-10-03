import type { ReactNode } from 'react';

// The revision pages' pinned bar (docs/revision-requirements.md §5): editing steps, so the editor's
// chrome (PostEditor.tsx's `editor-header-bar`, tuned in app/globals.css), shared so moving between
// them and the editor never swaps headers. Its column is the published page's (`max-w-page`), not the
// editor's, so it lines up with the post a revision previews; the controls move by half the
// difference when leaving the editor (docs/editor-requirements.md §12.35). `-mx-4 -mt-8` cancel
// PageMain's padding to reach the window's edges.
export function RevisionHeaderBar({ children }: { children: ReactNode }) {
  return (
    <div className='editor-header-bar sticky top-0 z-40 -mx-4 -mt-8 mb-8 border-b border-zinc-300 bg-background px-4 py-2 dark:border-zinc-700'>
      <div className='mx-auto flex max-w-page flex-wrap items-center gap-x-3 gap-y-2'>
        {children}
      </div>
    </div>
  );
}

// The editor header's icon-link shape, the same size on pointer and touch.
export const HEADER_ICON_LINK =
  'toolbar-button group/tt relative inline-flex items-center rounded px-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800';
