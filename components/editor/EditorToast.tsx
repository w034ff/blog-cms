// A short-lived notice for an action the editor refused, shown over the content where the author
// is looking rather than in the status area, where it went unread.
//
// Positioned against the sticky toolbar (a containing block for absolute children), so it stays on
// screen however far the author has scrolled; anchored to the frame it would scroll away.
//
// `role='status'` (an implicit aria-live="polite") announces it without interrupting typing — this
// reports a rule, not an error. `pointer-events-none` keeps it from swallowing a click on the
// content underneath until it clears on its own.
export function EditorToast({ message }: { message: string }) {
  return (
    <div
      role='status'
      // z-40: above the editor content, below the toolbar's own dropdown panels and tooltips
      // (z-50) so a menu opened at the same moment still wins.
      // `editor-toast` is the hook that flips this above the bar on a phone, where the toolbar it
      // hangs from is at the bottom of the screen and `top-full` would drop the notice off it
      // (app/globals.css, docs/editor-requirements.md §12.5).
      className='editor-toast pointer-events-none absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-zinc-700'>
      {message}
    </div>
  );
}
