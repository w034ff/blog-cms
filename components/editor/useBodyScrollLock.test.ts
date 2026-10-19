import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lockPageScroll } from './useBodyScrollLock';

// The stand-in for the browser's page: only the fields lockPageScroll reads and writes.
const page = {
  root: { clientWidth: 0 },
  body: { style: { overflow: '', paddingRight: '' } },
};

// `scrollbar`: the width a classic vertical scrollbar takes from the window, 0 for none.
function setPage(scrollbar: number) {
  page.root.clientWidth = 1280 - scrollbar;
  page.body.style.overflow = '';
  page.body.style.paddingRight = '';
  vi.stubGlobal('window', { innerWidth: 1280 });
  vi.stubGlobal('document', { documentElement: page.root, body: page.body });
}

describe('lockPageScroll', () => {
  beforeEach(() => setPage(15));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a showing scrollbar’s width while it hides the page’s overflow', () => {
    const release = lockPageScroll();
    expect(page.body.style.overflow).toBe('hidden');
    expect(page.body.style.paddingRight).toBe('15px');

    release();
    expect(page.body.style.overflow).toBe('');
    expect(page.body.style.paddingRight).toBe('');
  });

  it('reserves nothing on a page too short to scroll', () => {
    setPage(0);
    const release = lockPageScroll();
    expect(page.body.style.overflow).toBe('hidden');
    expect(page.body.style.paddingRight).toBe('');
    release();
  });

  it('holds until the last of nested locks is released, and a second release is a no-op', () => {
    const outer = lockPageScroll();
    const inner = lockPageScroll();

    inner();
    inner();
    expect(page.body.style.overflow).toBe('hidden');
    expect(page.body.style.paddingRight).toBe('15px');

    outer();
    expect(page.body.style.overflow).toBe('');
    expect(page.body.style.paddingRight).toBe('');
  });
});
