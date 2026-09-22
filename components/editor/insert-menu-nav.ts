'use client';

import { createContext, useContext } from 'react';

// Lets a `ToolbarDropdown` portal its picker into the ＋ sheet's own drilldown slot instead of
// opening its own floating panel, while staying mounted exactly where it already is.
// CalloutMenu's and TableGridMenu's own state — the size grid's hover highlight, its
// 行数・列数を入力… escape-hatch dialog — lives on the component instance that owns the trigger;
// unmounting that instance to show its picker elsewhere (an earlier version of this did exactly
// that, via a `render(close)` snapshot handed up to InsertMenu.tsx) silently orphans that state,
// since the closure's `setHover`/`setDialogOpen` would go on updating a fiber React has already
// discarded. A portal keeps the same fiber; only its DOM output moves. `activeTitle` identifies
// which dropdown is the one currently portalled in, since more than one trigger shares this sheet.
// InsertMenu.tsx is the only provider — a trigger outside the drawer (the desktop toolbar, and the
// pointer-only list menu in Toolbar.tsx) reads `null` here and keeps ToolbarDropdown's ordinary
// floating-panel behaviour untouched.
export type InsertMenuNav = {
  activeTitle: string | null;
  activate: (title: string) => void;
  deactivate: () => void;
  portalTarget: HTMLElement | null;
  // Closes the sheet whole — for a row that inserts something and is done (引用, 脚注, 画像), as
  // opposed to `deactivate`, which only backs out of a drilled-in picker to the row list. Rows
  // that drill in (囲み枠, 表) never call this themselves; InsertMenu.tsx is still the only
  // provider, so a trigger outside the drawer reads `null` here and this never applies to it.
  //
  // `InsertDialog` (リンク's own picker) does NOT reach this context — it is mounted as
  // PostEditor.tsx's own sibling of `InsertMenu`, not inside it (see InsertMenu.tsx's own comment
  // on why), so it is outside this provider's subtree entirely and `useInsertMenuNav()` there
  // would read `null` always, regardless of touch/drawer context. It talks to InsertMenu.tsx
  // through props PostEditor.tsx passes to both instead — see PostEditor.tsx's
  // `insertMenuOpen`/`setInsertMenuOpen`.
  closeMenu: () => void;
};

export const InsertMenuNavContext = createContext<InsertMenuNav | null>(null);

export function useInsertMenuNav(): InsertMenuNav | null {
  return useContext(InsertMenuNavContext);
}
