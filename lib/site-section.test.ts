import { describe, it, expect } from 'vitest';
import { getSiteSection, getInitialLetter } from './site-section';

describe('getSiteSection (docs/site-header-requirements.md §3.1)', () => {
  it('maps home and empty path to articles', () => {
    expect(getSiteSection('/')).toBe('articles');
    expect(getSiteSection('')).toBe('articles');
  });

  it('maps posts paths to articles, but excludes boundaries without slash', () => {
    expect(getSiteSection('/posts')).toBe('articles');
    expect(getSiteSection('/posts/')).toBe('articles');
    expect(getSiteSection('/posts/hello-world')).toBe('articles');
    expect(getSiteSection('/postsx')).toBeNull();
    expect(getSiteSection('/post')).toBeNull();
  });

  it('maps tags paths to articles, but excludes boundaries without slash', () => {
    expect(getSiteSection('/tags')).toBe('articles');
    expect(getSiteSection('/tags/')).toBe('articles');
    expect(getSiteSection('/tags/nextjs')).toBe('articles');
    expect(getSiteSection('/tagsfoo')).toBeNull();
  });

  it('maps categories paths to articles, but excludes boundaries without slash', () => {
    expect(getSiteSection('/categories')).toBe('articles');
    expect(getSiteSection('/categories/')).toBe('articles');
    expect(getSiteSection('/categories/tech')).toBe('articles');
    expect(getSiteSection('/categoriesbar')).toBeNull();
  });

  it('maps scribbles paths to scribbles, but excludes boundaries without slash', () => {
    expect(getSiteSection('/scribbles')).toBe('scribbles');
    expect(getSiteSection('/scribbles/')).toBe('scribbles');
    expect(getSiteSection('/scribbles/42')).toBe('scribbles');
    expect(getSiteSection('/scribblesbaz')).toBeNull();
  });

  it('returns null for admin screens, login, and unknown paths', () => {
    expect(getSiteSection('/admin')).toBeNull();
    expect(getSiteSection('/admin/')).toBeNull();
    expect(getSiteSection('/admin/posts')).toBeNull();
    expect(getSiteSection('/admin/posts/new')).toBeNull();
    expect(getSiteSection('/admin/library')).toBeNull();
    expect(getSiteSection('/admin/tags')).toBeNull();
    expect(getSiteSection('/login')).toBeNull();
    expect(getSiteSection('/login/')).toBeNull();
    expect(getSiteSection('/unknown')).toBeNull();
  });
});

describe('getInitialLetter (docs/site-header-requirements.md §3.3)', () => {
  it('converts ASCII letters to uppercase', () => {
    expect(getInitialLetter('alice')).toBe('A');
    expect(getInitialLetter('Admin')).toBe('A');
    expect(getInitialLetter('yubuu')).toBe('Y');
  });

  it('handles Japanese characters', () => {
    expect(getInitialLetter('太郎')).toBe('太');
    expect(getInitialLetter('花子')).toBe('花');
  });

  it('handles surrogate pairs as a single character', () => {
    // 𠮷 (U+20BB7) is represented by 2 UTF-16 code units (\uD842\uDFB7)
    expect(getInitialLetter('𠮷野')).toBe('𠮷');
    expect(getInitialLetter('𩸽')).toBe('𩸽');
  });

  it('handles empty string', () => {
    expect(getInitialLetter('')).toBe('');
  });
});
