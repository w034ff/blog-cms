import type { Root, Element, ElementContent } from 'hast';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';
import { resolveEmbed, type EmbedTarget } from './embed-provider';
import { hasClass } from './hast-class';
import { externalCardHost } from './link-card-href';

declare module 'vfile' {
  interface DataMap {
    // Every embed as its fallback link, never an iframe: for the scribble timeline, where a row of
    // players would make the list heavy (docs/scribble-requirements.md §5).
    embedsAsLinks: boolean;
  }
}

// The embed as the reader gets it (docs/embed-requirements.md §9.5). Built after sanitize, so its
// invented classes need no allow-listing. `embed-<provider>` carries the aspect ratio, held by a
// wrapper the iframe fills (an iframe with `aspect-ratio` alone negotiates its own size). The
// editor's NodeView builds the identical elements (§7).
function embedElement(target: EmbedTarget, instanceId: string, href: string): Element {
  return {
    type: 'element',
    tagName: 'div',
    // `data-embed-id`: the id the provider addresses its messages to (§10.5), read back by
    // components/EmbedFrames.tsx without parsing a URL. `data-href`: the reference the client-side
    // fallback builds its link from (§10.6), rather than reconstructing it from the src.
    properties: {
      className: ['embed', `embed-${target.provider}`],
      dataEmbedId: instanceId,
      dataHref: href,
    },
    children: [
      {
        type: 'element',
        tagName: 'div',
        properties: { className: ['embed-frame'] },
        children: [
          {
            type: 'element',
            tagName: 'iframe',
            properties: {
              // `srcdoc` or `src`, never both (§18.5).
              ...(target.srcdoc === null
                ? { src: target.src(instanceId) }
                : { srcDoc: target.srcdoc(target.src(instanceId), instanceId) }),
              title: target.title,
              // The third party is asked only when the reader scrolls there (§9.5, §8-①).
              loading: 'lazy',
              // §10.8: X's `Tweet.html` reserves a scrollbar track that nothing scrolls. Obsolete
              // but honoured; a no-op for YouTube, so it goes on every provider. **Unconditional
              // because no box here clips what it holds** (§18.4).
              scrolling: 'no',
              referrerPolicy: 'strict-origin-when-cross-origin',
              allow: target.allow,
              // §18.6: omitted unless the provider asks, since `sandbox=""` is the most
              // restrictive value and would stop players that run script.
              ...(target.sandbox === null ? {} : { sandbox: target.sandbox.split(' ') }),
              allowFullScreen: true,
            },
            children: [],
          },
        ],
      },
    ],
  };
}

// The fallback for an unclaimed but publishable URL (§9.4): a plain unwrapped link, since silently
// dropping the node would shorten the body. **No `target`:** `rehypeNewTabLinks` decides it later.
// The shape is `lib/embed-fallback.ts`'s, which the client reproduces for an unfetchable embed
// (§10.6) and adds `target` itself.
function fallbackLink(href: string): Element {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href },
    children: [{ type: 'text', value: href }],
  };
}

// Resolves `<div class="embed" data-href="…">` into an iframe, a link, or nothing. **After
// sanitize** (lib/render.ts): `<iframe>` must never enter the schema (§6), so its `src` meets no
// check; hence `resolveEmbed` builds it from a verified id, and the editor asks the same function.
// Synchronous, with nothing to inject (§3.2). Two passes, since removing nodes mid-walk would
// renumber indices still to be visited.
export function rehypeEmbed() {
  return (tree: Root, file: VFile) => {
    const asLinks = file.data.embedsAsLinks === true;
    const found: { node: Element; parent: Root | Element; index: number }[] = [];
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'div' || !hasClass(node, 'embed')) return;
      // **`data-href` is part of the claim**, not only what is read: an author's own
      // `<div class="embed">` would otherwise be removed with its children. The editor always writes
      // the attribute.
      if (typeof node.properties.dataHref !== 'string') return;
      if (!parent || typeof index !== 'number') return;
      found.push({ node, parent, index });
    });
    if (found.length === 0) return;

    const replacements: (ElementContent | null)[] = found.map(({ node }, index) => {
      const href = node.properties.dataHref;
      // An empty reference names nothing and can't degrade to a link.
      if (typeof href !== 'string' || href === '') return null;
      const target = asLinks ? null : resolveEmbed(href);
      // Unique per document. Not `embed-`, which is what X names an iframe given no id.
      if (target) return embedElement(target, `emb-${index}`, href);
      // **The fallback is published markup too, built after sanitize**, so `javascript:` must be
      // refused here (link-card-requirements.md §4.4): `externalCardHost` requires http(s), a parse
      // and no credentials; failing that, the node is dropped, as for a card.
      return externalCardHost(href) !== null ? fallbackLink(href) : null;
    });

    // Right to left within each parent, so a splice can't shift a later index.
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const { parent, index } = found[i];
      const replacement = replacements[i];
      if (replacement) parent.children[index] = replacement;
      else parent.children.splice(index, 1);
    }
  };
}
