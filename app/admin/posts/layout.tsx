import { PageMain, SiteColumn } from '@/components/PageShell';

// The editor screens' shell. No SiteHeader and no SiteFooter: note and Zenn both replace the
// site's header with the document's own on the writing screen (measured 2026-09-11), and what a
// reader navigates by — Tags, Categories — answers nothing an author is asking here.
//
// The <main> and the column width are this shell's own, because app/admin/layout.tsx is the auth
// gate and nothing else; 記事一覧 has its own copy for the same reason.
//
// The way back out is NOT here. It renders inside PostEditor's <form>, which is the side of the
// boundary it has to be on before it can share a bar with 記事の設定 — those are form fields, and
// useAutosave reads the whole form with `new FormData(form)`.
export default function PostEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageMain>
      <SiteColumn>{children}</SiteColumn>
    </PageMain>
  );
}
