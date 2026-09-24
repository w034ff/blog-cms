'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// How long a notice stays up. Long enough to read one short line, short enough that it doesn't
// linger over the text being edited.
const NOTICE_MS = 3000;

// The editor's refusal notice: one short line shown over the content (EditorToast) when a gesture
// was declined and there is nothing on screen to say why.
//
// A refused button explains itself by greying out; paste and drop have no control to grey.
// PostEditor owns the single instance every guard writes to, so two refusals never stack toasts.
export function useEditorNotice(): {
  notice: string | null;
  showNotice: (message: string) => void;
} {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Raise the notice, restarting the countdown if one is already up.
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
