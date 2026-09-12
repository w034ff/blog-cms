import Link from 'next/link';
import { PageMain, SiteColumn } from '@/components/PageShell';

// The editor screens' shell. No SiteHeader and no SiteFooter: note and Zenn both replace the
// site's header with the document's own on the writing screen (measured 2026-09-11), and what a
// reader navigates by — Tags, Categories — answers nothing an author is asking here.
//
// The <main> and the column width are this shell's own, because app/admin/layout.tsx is the auth
// gate and nothing else; 記事一覧 has its own copy for the same reason.
//
// **A line of its own, and that placement was measured** (2026-09-12, in the real editor): at the
// head of the pinned publish row it becomes a third small grey item next to 未公開 and 未保存…,
// reads as another status and stops being findable; set beside the title it takes the title's left
// edge out of line with the 記事の設定 box and the publish row under it. Alone above the title is
// where note (閉じる) and Zenn (←) put it. The cost is one line, ~32px.
//
// No arrow. The two references disagree — note labels it, Zenn draws only the glyph — and carrying
// both said the same thing twice: the position is already top-left above everything, and the label
// already names the destination.
//
// A layout rather than a line in each page, so both editor screens have it and the next one does
// too. Leaving is safe to offer plainly: autosave holds the draft (components/editor/useAutosave.ts).
export default function PostEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageMain>
      <SiteColumn>
        <div className='pb-2'>
          <Link href='/admin' className='text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
            記事一覧
          </Link>
        </div>
        {children}
      </SiteColumn>
    </PageMain>
  );
}
