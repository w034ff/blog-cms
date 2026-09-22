// A short-lived notice for an action the editor refused, shown over the content instead of in the
// page chrome. When a paste is rejected the author is looking at the caret, so a line in the
// status area beside the autosave text sits outside their attention and goes unread.
//
// Positioned against the sticky toolbar rather than the editor frame: `position: sticky` is a
// containing block for absolute children, so the notice rides along with the pinned toolbar and
// stays on screen no matter how far down a long post the author has scrolled. An absolute box on
// the frame itself would be anchored to the frame's top edge and scroll away with it.
//
// `role='status'` (an implicit aria-live="polite") announces it without interrupting typing — this
// reports a rule, not an error. `pointer-events-none` keeps it from swallowing a click on the
// content underneath while it fades away on its own.
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
