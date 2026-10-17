import type { Element, ElementContent } from 'hast';

// Shared across the rehype plugins to identify target elements by class token.
// Exact matching prevents compound names like `link-card-view` from matching `link-card`.
export function hasClass(node: ElementContent, name: string): node is Element {
  if (node.type !== 'element') return false;
  const { className } = node.properties;
  return Array.isArray(className) && className.includes(name);
}
