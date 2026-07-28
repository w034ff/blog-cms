'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// How long a notice stays up. Long enough to read one short line, short enough that it doesn't
// linger over the text being edited.
const NOTICE_MS = 3000;

// The editor's refusal notice: one short line shown over the content (EditorToast) when a gesture
// was declined and there is nothing on screen to say why.
//
// The toolbar greys out a control an insert can't use, so a refused *button* explains itself. Paste
// and drag-and-drop have no control to grey — they just do nothing — which is why they need this.
//
// Lifted out of useImageUpload, which owned it while images were the only refusal that reached the
// author this way. It is not image-specific: the table cell paste guard (table-extensions.ts) uses
// the same channel, and PostEditor now owns the one instance both write to, so two refusals in a
// row can't leave two toasts fighting over the same corner.
export function useEditorNotice(): {
  notice: string | null;
  showNotice: (message: string) => void;
} {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Raise the notice and start its countdown, restarting the clock if one is already up (a second
  // refused paste should get its own full three seconds, not the tail of the first).
  const showNotice = useCallback((message: string): void => {
    setNotice(message);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);

  // A pending timer would fire into an unmounted component when the editor is torn down.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  return { notice, showNotice };
}
