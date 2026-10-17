import type { Element, Text } from 'hast';
import { describe, expect, it } from 'vitest';
import { hasClass } from './hast-class';

describe('hasClass', () => {
  it('returns true when element className includes the target class', () => {
    const element: Element = {
      type: 'element',
      tagName: 'div',
      properties: { className: ['lead', 'prose'] },
      children: [],
    };
    expect(hasClass(element, 'lead')).toBe(true);
    expect(hasClass(element, 'prose')).toBe(true);
  });

  it('returns false when element className does not include the target class', () => {
    const element: Element = {
      type: 'element',
      tagName: 'div',
      properties: { className: ['lead'] },
      children: [],
    };
    expect(hasClass(element, 'prose')).toBe(false);
  });

  it('returns false when element has no className property', () => {
    const element: Element = {
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [],
    };
    expect(hasClass(element, 'lead')).toBe(false);
  });

  it('returns false for text nodes', () => {
    const text: Text = {
      type: 'text',
      value: 'lead',
    };
    expect(hasClass(text, 'lead')).toBe(false);
  });

  it('does not match by prefix', () => {
    const element: Element = {
      type: 'element',
      tagName: 'div',
      properties: { className: ['link-card-view'] },
      children: [],
    };
    expect(hasClass(element, 'link-card')).toBe(false);
  });
});
