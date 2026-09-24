'use client';

import { createContext, useContext } from 'react';

// Lets a `ToolbarDropdown` portal its picker into the ＋ sheet's drilldown slot instead of opening
// its own floating panel, while staying mounted where it is. CalloutMenu's and TableGridMenu's
// state (hover highlight, the 行数・列数を入力… dialog) lives on the trigger's instance; rendering the
// picker elsewhere from a `render(close)` snapshot orphaned that state on a discarded fiber. A
// portal keeps the fiber and moves only the DOM. `activeTitle` names the dropdown currently
// portalled in. InsertMenu.tsx is the only provider; triggers outside the drawer read `null` and
// keep the floating panel.
export type InsertMenuNav = {
  activeTitle: string | null;
  activate: (title: string) => void;
  deactivate: () => void;
  portalTarget: HTMLElement | null;
  // Closes the whole sheet, for a row that inserts and is done (引用, 脚注, 画像); `deactivate` only
  // backs out of a drilled-in picker. `InsertDialog` is a sibling of InsertMenu in PostEditor.tsx,
  // outside this provider, so it reaches the sheet through PostEditor's
  // `insertMenuOpen`/`setInsertMenuOpen` props instead.
  closeMenu: () => void;
};

export const InsertMenuNavContext = createContext<InsertMenuNav | null>(null);

export function useInsertMenuNav(): InsertMenuNav | null {
  return useContext(InsertMenuNavContext);
}
