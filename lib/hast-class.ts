import type { Element, ElementContent } from 'hast';

// Type guard checking whether a HAST node is an element whose className property
// includes the given class name.
export function hasClass(node: ElementContent, name: string): node is Element {
  if (node.type !== 'element') return false;
  const { className } = node.properties;
  return Array.isArray(className) && className.includes(name);
}
