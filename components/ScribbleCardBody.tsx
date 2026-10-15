'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// Cutoff threshold for long scribble bodies on the list page (docs/scribble-requirements.md §5).
export const SCRIBBLE_CARD_MAX_HEIGHT_PX = 300;

export function ScribbleCardBody({
  html,
  slug,
  targetId,
}: {
  html: string;
  slug: string | null;
  targetId: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const measure = () => {
      const height = Math.max(el.offsetHeight, el.scrollHeight);
      setIsClamped(height > SCRIBBLE_CARD_MAX_HEIGHT_PX);
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className='mt-3'>
      <div
        id={targetId}
        data-scribble-body-box
        className={isClamped ? 'relative overflow-hidden' : ''}
        style={isClamped ? { maxHeight: `${SCRIBBLE_CARD_MAX_HEIGHT_PX}px` } : undefined}>
        <div
          ref={contentRef}
          className='flow-root prose prose-zinc dark:prose-invert max-w-none'
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {isClamped && (
          <div
            aria-hidden='true'
            className='scribble-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-16'
          />
        )}
      </div>
      {isClamped && (
        <div className='mt-3'>
          <Link
            href={`/scribbles/${slug ?? ''}`}
            className='inline-flex items-center text-sm font-medium hover:underline'>
            続きを読む →
          </Link>
        </div>
      )}
    </div>
  );
}
