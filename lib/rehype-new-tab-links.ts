import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

// Decides, in one place, which published links open in a new tab (docs/link-requirements.md §7.2).
// Two shapes get `target="_blank"`:
//
//   1. **A link that leaves this site** — an author's own external link, and the plain link a card
//      or an embed falls back to when its reference resolves to nothing.
//   2. **A link card**, wherever it points. A card is a block-level aside that stands for a whole
//      other article, not a word in a sentence, and an internal one is the same component as an
//      external one — so the reader gets one behaviour from one component rather than two
//      (2026-08-21, §7.2; docs/link-card-requirements.md §14.8).
//
// Must run AFTER rehype-sanitize, which strips `target` off any anchor that reaches it: the schema
// is deliberately not widened, because widening it would let an author hand-write `target` in raw
// HTML and weaken the "the author is not trusted" premise lib/render.ts is built on (§7). This
// stage is the after-sanitize half of that arrangement, the same shape rehypeClobberFragmentLinks
// and rehypeCollectToc already have.
//
// It also runs after rehypeLinkCard and rehypeEmbed — necessarily, since rule 2 reads a node those
// stages build, and rule 1 covers their fallback links. Neither stage decides for itself.
//
// **`href` starting with `http://` or `https://` is the whole of rule 1.** Every way of pointing at
// this site is a relative path or a fragment (measured, §2.3), so the two sets are already
// separated and there is nothing to compare against `siteOrigin` — which is `localhost:3001` in dev
// and another host in production, so consulting it would make the published HTML depend on the
// environment (§10). It is also what keeps the table of contents, footnote references and their ↩
// backrefs out: all of them are `#…`, including one an author hand-wrote as `#user-content-…` after
// copying an href off a published page (§2.1.1), which is indistinguishable from a generated one by
// its text but is not a link that leaves the site (§7.2 item 2). `mailto:` and `xmpp:` — the other
// two schemes sanitize permits — are outside it as well: handing them to a new tab would open a
// blank one beside the mail client.
//
// **A protocol-relative `//example.com` is the one off-site href rule 1 misses**, since sanitize
// passes it as a relative URL and it carries no scheme (measured 2026-08-21, and pinned by a test
// in lib/render.test.ts). That is the behaviour it had before this stage existed, and §7.2 item 1
// says why it is left alone rather than parsed with `new URL()`: the value of the rule is that
// everything staying on this site is outside it by shape, and nothing in the repo writes this form.
//
// **Rule 2 is the class, not the reference**, so a card that resolved to nothing is not covered by
// it — `fallbackLink` emits a bare `<a>` with no class, which is the shape it should be judged as
// (§7.2 item 4). An internal one therefore stays in this tab, an external one leaves by rule 1.
//
// No `rel`. A modern browser applies `noopener` to `target="_blank"` implicitly, so there is no
// attack surface to close, and `noreferrer` would withhold from the target exactly what §7 refuses
// to withhold with `nofollow`.
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
