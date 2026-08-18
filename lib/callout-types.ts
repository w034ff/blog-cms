// The one definition of what a callout is, shared by the editor (client) and the render
// pipeline (server) — keep this module importable from both sides (no 'server-only'), the
// same rule lib/content.ts states for its own reason.
//
// It exists because the answer used to be written down five times: the type union and the
// Japanese titles in components/editor/callout-extension.ts and again in
// lib/remark-github-alerts.ts, the `note|warning|caution` alternation in three separate
// regexes across those two files, and the `markdown-alert-*` class names a third time in
// lib/render.ts's sanitize schema. Four of those five would fail loudly enough — a missing
// type simply does not parse — but the fifth is silent: a class the schema does not list is
// stripped from the published HTML, so a new tier would round-trip through the editor, save
// correctly, and render on the public page with no colour and no error anywhere. Everything
// below is derived from CALLOUT_TYPES so that adding a tier is one edit here.
//
// What is deliberately *not* here:
//   - `:::info` / `:::warning` / `:::danger`, the editor's typing shortcuts. That vocabulary
//     is a different one on purpose (`:::warning` is `caution`, `:::danger` is `warning`) and
//     lives with the input rule that owns it, in callout-extension.ts.
//   - The menu order. Insert menus list the tiers 情報 → 注意 → 警告, which is neither this
//     file's order nor a fact the parser or the renderer has any use for; it stays with the
//     UI as CALLOUT_MENU_ORDER.
//   - app/globals.css, which paints these classes and cannot import anything. That coupling
//     is unchanged and still has to be edited by hand.

// The severity ladder, and the order the derived alternation lists the tiers in. GitHub's
// `[!TIP]` / `[!IMPORTANT]` are intentionally absent — this site scopes to the 3-tier set the
// Zenn/Qiita convention uses.
export const CALLOUT_TYPES = ['note', 'warning', 'caution'] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number];

// Japanese callout titles (the site UI is Japanese). Shown as the label chip in the editor and
// as the sr-only span on the published page.
export const CALLOUT_TITLES: Record<CalloutType, string> = {
  note: '情報',
  warning: '警告',
  caution: '注意',
};

// The GitHub-alert tag written to markdown, one per type. Uppercase is the form GitHub
// documents; the patterns below read it back case-insensitively either way.
export const CALLOUT_MARKERS: Record<CalloutType, string> = {
  note: '[!NOTE]',
  warning: '[!WARNING]',
  caution: '[!CAUTION]',
};

// Narrow a raw attribute / capture group to a CalloutType, defaulting to note.
export function toCalloutType(value: string | null | undefined): CalloutType {
  return CALLOUT_TYPES.includes(value as CalloutType) ? (value as CalloutType) : 'note';
}

const TYPE_ALTERNATION = CALLOUT_TYPES.join('|');

// An already-stored marker, sitting alone on the blockquote's first line (GitHub's rule): the
// type tag, optional trailing spaces, then a newline or the end of the text. Both surfaces
// strip it with this — the mdast transform on the public side, the parse hook on the editor
// side — and they have to agree, since a marker only one of them recognises is either an
// unstyled quote or a literal `[!NOTE]` in the prose.
//
// Case-insensitive so `[!note]` also matches. Not global, so the single shared instance
// carries no `lastIndex` between the two callers.
export const CALLOUT_MARKER_LINE = new RegExp(
  `^\\[!(${TYPE_ALTERNATION})\\][^\\S\\n]*(?:\\n|$)`,
  'i',
);

// The same marker as an input rule, ready to commit on a trailing space — the shape every
// other markdown shortcut in this editor takes. Distinct from CALLOUT_MARKER_LINE, which
// wants a newline or the end of the text after it because by then the line is stored.
export const CALLOUT_MARKER_INPUT = new RegExp(`^\\[!(${TYPE_ALTERNATION})\\]\\s$`, 'i');

// GitHub's own class names, which both surfaces emit and the sanitize schema must allow
// exactly. Held here rather than written out at each site for the silent-failure reason at the
// top of this file.
export const CALLOUT_CLASS = 'markdown-alert';
export const CALLOUT_CONTENT_CLASS = 'markdown-alert-content';
export const CALLOUT_TITLE_CLASS = 'markdown-alert-title';
export const CALLOUT_TITLE_LABEL_CLASS = 'markdown-alert-title-label';

export function calloutTypeClass(type: CalloutType): string {
  return `${CALLOUT_CLASS}-${type}`;
}

// Every class the alert markup puts on a <div>, in the form rehype-sanitize's value allowlist
// wants. Derived, so a new tier reaches the schema without anyone remembering to add it.
export const CALLOUT_DIV_CLASSES: readonly string[] = [
  CALLOUT_CLASS,
  ...CALLOUT_TYPES.map(calloutTypeClass),
  CALLOUT_CONTENT_CLASS,
];
