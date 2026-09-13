import { PageMain } from '@/components/PageShell';

// The editor screens' shell. No SiteHeader and no SiteFooter: note and Zenn both replace the
// site's header with the document's own on the writing screen (measured 2026-09-11), and what a
// reader navigates by — Tags, Categories — answers nothing an author is asking here.
//
// The <main> is this shell's own, because app/admin/layout.tsx is the auth gate and nothing else;
// 記事一覧 has its own copy for the same reason.
//
// The column is NOT here, and that is the difference from 記事一覧's shell. PostEditor's header
// bar spans the window — its rule and its background run edge to edge, the way SiteHeader's do —
// so the editor applies SiteColumn to everything *except* that bar. A column wrapped around the
// whole form could not have been broken out of: the bar cancels PageMain's `px-4` with `-mx-4`,
// which reaches the window only because PageMain is the full-bleed element directly above it.
//
// The way back out is not here either. It renders inside PostEditor's <form>, which is the side
// of the boundary it has to be on to share a bar with 記事の設定 and 更新 — those are form
// fields and form submits, and useAutosave reads the whole form with `new FormData(form)`.
export default function PostEditorLayout({ children }: { children: React.ReactNode }) {
  return <PageMain>{children}</PageMain>;
}
