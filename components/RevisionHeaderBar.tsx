import type { ReactNode } from 'react';

// The pinned bar the revision pages wear in place of the site's header (docs/revision-requirements.md
// §5): the history list and the preview are steps in editing, so both take the editor's chrome —
// PostEditor.tsx's `editor-header-bar`, whose heights app/globals.css tunes per pointer. Shared so
// moving between the two pages, and back into the editor, never swaps one header for another.
//
// `-mx-4 -mt-8` cancel PageMain's padding (app/admin/posts/layout.tsx), which is what lets the rule
// and the background run to the window's edges while the contents keep to the site column.
export function RevisionHeaderBar({ children }: { children: ReactNode }) {
  return (
    <div className='editor-header-bar sticky top-0 z-40 -mx-4 -mt-8 mb-8 border-b border-zinc-300 bg-background px-4 py-2 dark:border-zinc-700'>
      <div className='mx-auto flex max-w-site flex-wrap items-center gap-x-3 gap-y-2'>
        {children}
      </div>
    </div>
  );
}

// The header's icon links, in the editor header's own shape (PostEditor.tsx's 記事一覧 and
// 記事の設定 controls): the same classes give them the same size on a pointer and on touch.
export const HEADER_ICON_LINK =
  'toolbar-button group/tt relative inline-flex items-center rounded px-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800';
