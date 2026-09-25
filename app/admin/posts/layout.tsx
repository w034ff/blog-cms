import type { Viewport } from 'next';
import { PageMain } from '@/components/PageShell';

// `resizes-content` shrinks the layout viewport on Android so the bottom toolbar rides above the
// keyboard (docs/editor-requirements.md §12.5); iOS ignores it and uses useKeyboardInset.ts, which
// reads ~0 here, so the two do not stack. Editor shell only, since it changes every fixed element.
// A viewport export replaces Next's default, hence `width` and `initialScale`.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
};

// No SiteHeader or SiteFooter on the writing screen. The <main> is this shell's own, because
// app/admin/layout.tsx is only the auth gate.
//
// No column here: PostEditor's header bar spans the window by cancelling PageMain's `px-4` with
// `-mx-4`, which works only with PageMain directly above it, so the editor applies SiteColumn to the
// rest. The way back is inside PostEditor's <form>, sharing a bar with 記事の設定 and 更新.
export default function PostEditorLayout({ children }: { children: React.ReactNode }) {
  return <PageMain>{children}</PageMain>;
}
