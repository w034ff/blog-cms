import type { Viewport } from 'next';
import { PageMain } from '@/components/PageShell';

// `resizes-content` is what puts the editor's bottom toolbar above the software keyboard on
// Android rather than underneath it: the layout viewport itself shrinks when the keyboard opens,
// so the bar's `bottom: 0` follows it with no measurement at all (docs/table-requirements.md
// §12.5). iOS Safari ignores this key and is handled by components/editor/useKeyboardInset.ts,
// whose formula comes out at ~0 here — the two do not stack.
//
// Declared on the editor's shell and not on the root layout on purpose: it changes how every
// fixed element on a page behaves while a keyboard is open, and the public site has no reason to
// take that. `width` and `initialScale` are restated because a viewport export replaces Next's
// default rather than merging with it.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
};

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
