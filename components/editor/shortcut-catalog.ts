// **The keys this editor shows an author, in the order 書き方 lists them.**
//
// One list, two consumers, and the direction matters: this is the *superset*, and `Toolbar.tsx`
// looks up the entries it has a button for. Built the other way round — collecting the toolbar's
// own props — it would silently omit exactly the keys the help sheet exists for: `Mod-k` (the
// toolbar's リンク button is `openInsertDialog`, a different command with no key) and `Mod-e`
// (inherited from @tiptap/extension-code, and no UI calls `toggleCode` at all).
//
// **It is not the editor's whole keymap and does not try to be.** `guarded-toggle-marks.ts`
// deletes `Mod-B` so `Mod-Shift-B` can reach blockquote; `Tab`, `Mod-Alt-0` and `Mod-y` are all
// live and deliberately unlisted. docs/cms-features.md「書き方ヘルプ」§4.3 holds that sweep and
// the reason for each exclusion — the rule is "no other way to know it, *and* you would not guess
// it", which is why `Tab` (everyone's first try, and it works) is out and `Mod-k` is in.
//
// `label` is shown on both surfaces: the sheet's row and, where there is a button, its tooltip and
// accessible name. The toolbar's リンク button keeps its own literal 'リンク' — same word, other
// command — which is why entries are looked up by id rather than matched by label.
export const SHORTCUT_CATALOG = [
  { id: 'bold', label: '太字', token: 'Mod-b' },
  { id: 'italic', label: '斜体', token: 'Mod-i' },
  { id: 'strike', label: '取り消し線', token: 'Mod-Shift-s' },
  { id: 'accentEmphasis', label: '強調', token: 'Mod-Shift-e' },
  { id: 'code', label: 'コード', token: 'Mod-e' },
  { id: 'heading2', label: '大見出し', token: 'Mod-Alt-2' },
  { id: 'heading3', label: '小見出し', token: 'Mod-Alt-3' },
  { id: 'bulletList', label: '箇条書き', token: 'Mod-Shift-8' },
  { id: 'orderedList', label: '番号付き', token: 'Mod-Shift-7' },
  { id: 'blockquote', label: '引用', token: 'Mod-Shift-b' },
  { id: 'codeBlock', label: 'コードブロック', token: 'Mod-Alt-c' },
  { id: 'footnote', label: '脚注', token: 'Mod-Shift-f' },
  { id: 'link', label: 'リンク', token: 'Mod-k' },
  { id: 'hardBreak', label: '改行', token: 'Shift-Enter' },
  { id: 'undo', label: '元に戻す', token: 'Mod-z' },
  { id: 'redo', label: 'やり直す', token: 'Mod-Shift-z' },
] as const satisfies readonly { id: string; label: string; token: string }[];

export type ShortcutId = (typeof SHORTCUT_CATALOG)[number]['id'];
export type ShortcutEntry = (typeof SHORTCUT_CATALOG)[number];

// Keyed access for the toolbar, which wants one entry at a time and names it in the markup
// (`SHORTCUT.bold.token`). Derived rather than written out a second time.
export const SHORTCUT = Object.fromEntries(
  SHORTCUT_CATALOG.map((entry) => [entry.id, entry]),
) as Record<ShortcutId, ShortcutEntry>;
