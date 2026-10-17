import type { Element, ElementContent, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';
import { toString } from 'hast-util-to-string';
import {
  SUMMARY_BODY_CLASS,
  SUMMARY_CLASS,
  SUMMARY_LABEL_CLASS,
  SUMMARY_SECTION_BODY_CLASS,
  SUMMARY_SECTION_CLASSES,
  SUMMARY_SECTION_LABEL_CLASS,
  SUMMARY_SECTION_TITLES,
  SUMMARY_TITLE,
  TLDR_CLASS,
  TLDR_TITLE,
  type SummarySectionKind,
} from './summary-types';
import { hasClass } from './hast-class';

// The published side of the まとめ and TL;DR blocks (docs/summary-requirements.md §8): the stored
// form carries only the containers, so the titles and the wrappers they sit in are added here, as the
// same DOM the editor's NodeViews build (components/editor/summary-extension.ts), which one set of
// rules in app/globals.css paints.
//
// After rehype-sanitize, so the chrome's classes need no allow-listing. The titles are <p>, not
// headings: a heading would enter the reading order as a section of the post, and the table of
// contents would have to decide about it (docs/toc-requirements.md).
//
// Nothing empty is drawn: a section with no text (added and never written, §3.1), and a whole box
// with no text.

function isEmpty(node: ElementContent): boolean {
  return toString(node).trim() === '';
}

function element(tagName: string, className: string, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties: { className: [className] }, children };
}

function label(className: string, text: string): Element {
  return element('p', className, [{ type: 'text', value: text }]);
}

function sectionKindOf(node: ElementContent): SummarySectionKind | null {
  if (hasClass(node, SUMMARY_SECTION_CLASSES.good)) return 'good';
  if (hasClass(node, SUMMARY_SECTION_CLASSES.bad)) return 'bad';
  return null;
}

function dressSection(section: Element, kind: SummarySectionKind): Element {
  section.children = [
    label(SUMMARY_SECTION_LABEL_CLASS, SUMMARY_SECTION_TITLES[kind]),
    element('div', SUMMARY_SECTION_BODY_CLASS, section.children),
  ];
  return section;
}

export function rehypeSummary() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      const isSummary = hasClass(node, SUMMARY_CLASS);
      if (!isSummary && !hasClass(node, TLDR_CLASS)) return undefined;
      if (parent && typeof index === 'number' && isEmpty(node)) {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
      const content: ElementContent[] = [];
      for (const child of node.children) {
        const kind = isSummary ? sectionKindOf(child) : null;
        if (!kind) content.push(child);
        else if (!isEmpty(child) && child.type === 'element')
          content.push(dressSection(child, kind));
      }
      node.children = [
        label(SUMMARY_LABEL_CLASS, isSummary ? SUMMARY_TITLE : TLDR_TITLE),
        element('div', SUMMARY_BODY_CLASS, content),
      ];
      return SKIP;
    });
  };
}
