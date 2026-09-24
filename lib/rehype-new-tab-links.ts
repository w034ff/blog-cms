import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

// Which published links open in a new tab (docs/link-requirements.md §7.2):
//
//   1. **A link leaving this site**, including a card's or embed's fallback link.
//   2. **A link card**, wherever it points: one component, one behaviour
//      (docs/link-card-requirements.md §14.8).
//
// **After rehype-sanitize**, which strips `target`: the schema is not widened, or authors could
// hand-write `target` and weaken lib/render.ts's untrusted-author premise. After rehypeLinkCard and
// rehypeEmbed too, whose output both rules read.
//
// **Rule 1 is `href` starting with `http://` or `https://`.** Everything on this site is a relative
// path or a fragment (§2.3), so no comparison with `siteOrigin` (which differs per environment,
// §10); fragments, including hand-written `#user-content-…` (§2.1.1), and `mailto:`/`xmpp:` stay out.
// A protocol-relative `//example.com` slips past, left alone as §7.2 item 1 explains (pinned in
// lib/render.test.ts).
//
// **Rule 2 is the class**, so a card that fell back to a bare `<a>` is judged by rule 1 (§7.2
// item 4).
//
// No `rel`: browsers imply `noopener` for `target="_blank"`, and `noreferrer` would withhold what §7
// declines to withhold with `nofollow`.
function isLinkCard(node: Element): boolean {
  const className = node.properties.className;
  return Array.isArray(className) && className.includes('link-card');
}

export function rehypeNewTabLinks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = node.properties.href;
      // No href at all is what sanitize leaves behind when it drops a `javascript:` one (§2.3), and
      // an anchor that navigates nowhere has no tab to open.
      if (typeof href !== 'string') return;
      if (!/^https?:\/\//i.test(href) && !isLinkCard(node)) return;
      node.properties.target = '_blank';
    });
  };
}
