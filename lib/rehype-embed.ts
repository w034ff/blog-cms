import type { Root, Element, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';
import { resolveEmbed, type EmbedTarget } from './embed-provider';
import { externalCardHost } from './link-card-href';

function hasClass(node: Element, name: string): boolean {
  const className = node.properties.className;
  return Array.isArray(className) && className.includes(name);
}

// The embed as the reader gets it (docs/embed-requirements.md §9.5). Every class here is invented
// by this stage, which runs after sanitize, so none of it needs allow-listing — the same position,
// and the same reason, rehypeLinkCard and rehype-pretty-code's own spans rely on. `embed-<provider>`
// is what carries the aspect ratio, so a provider shaped differently changes one stylesheet rule
// rather than this function.
//
// The frame is a wrapper rather than a bare iframe because the ratio has to be held by a box the
// iframe fills: an `<iframe>` given `aspect-ratio` alone still negotiates its own size with its
// replaced-element defaults. The editor's NodeView builds the identical two elements, which is what
// keeps §7's "what the author is looking at is what the reader gets" true of the box as well as of
// the player.
function embedElement(target: EmbedTarget, instanceId: string, href: string): Element {
  return {
    type: 'element',
    tagName: 'div',
    // `data-embed-id` names this placement for the reader's browser: the provider addresses its
    // messages to the id it was given (§10.5), and `components/EmbedFrames.tsx` reads the attribute
    // back to find the box a `resize` belongs to. Written here rather than derived from the src so
    // the client never has to parse a URL it did not build.
    // `data-href` survives onto the published element because the client-side fallback needs the
    // reference to build its link from (§10.6) and must not reconstruct it from the src, which is
    // this file's output rather than the author's input. It is the same public URL either way.
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
              // One or the other, never both: a provider that brings a document of its own is
              // framed in that, and the `src` it was built from appears only inside it (§18.5).
              ...(target.srcdoc === null
                ? { src: target.src(instanceId) }
                : { srcDoc: target.srcdoc(target.src(instanceId), instanceId) }),
              title: target.title,
              // Below the fold, the third party is not asked for anything until the reader scrolls
              // that far (§9.5). The request cannot be removed — that is §8-① — but it can be made
              // to follow the reader's own attention.
              loading: 'lazy',
              // §10.8. `Tweet.html` sets `overflow-y: scroll` on its own `<html>`, which reserves a
              // scrollbar track whether or not anything overflows — a 15px bar down the right edge
              // of a post that fits, stealing 15px of the width the post lays itself out in. The
              // attribute is obsolete in HTML5 and honoured by current Chrome; the day it stops
              // being honoured, the embed is back to what it looks like today. A no-op for YouTube,
              // whose player already sets `overflow: hidden` on both `<html>` and `<body>`, which is
              // why it goes on every provider rather than becoming a branch in `resolveEmbed`.
              //
              // **It stays unconditional because no box here clips what it holds.** The gist was
              // briefly an exception, when its box was a fixed height and the rest had to stay
              // reachable — and the wheel then belonged to the frame rather than the article for as
              // long as the pointer crossed it (§18.4, measured 2026-08-29). Sizing the box to the
              // gist removed the exception rather than managing it.
              scrolling: 'no',
              referrerPolicy: 'strict-origin-when-cross-origin',
              allow: target.allow,
              // §18.6. Omitted entirely unless the provider asks: `sandbox=""` is the most
              // restrictive value there is, not the absence of one, and it would stop every player
              // here that runs a script of its own.
              ...(target.sandbox === null ? {} : { sandbox: target.sandbox }),
              allowFullScreen: true,
            },
            children: [],
          },
        ],
      },
    ],
  };
}

// The fallback for a reference no provider claims but which is still a publishable URL — a
// playlist, a channel, another site (§9.4). A plain link, for rehypeLinkCard's reason: nothing is lost for the reader,
// and the author sees a link where they expected an embed, whereas dropping the node would make the
// body silently shorter. Unwrapped, so it fits wherever the `<div>` fitted.
//
// **`target` is deliberately absent.** `rehypeNewTabLinks` runs after this stage and decides it in
// one place for the whole document. The shape this ends up with is what `lib/embed-fallback.ts`
// describes, and it is what the reader's browser has to reproduce when a resolved embed turns out
// to be unfetchable (§10.6) — that path gets no later stage, so it adds `target` itself.
function fallbackLink(href: string): Element {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href },
    children: [{ type: 'text', value: href }],
  };
}

// Resolves `<div class="embed" data-href="…">` into an iframe, a plain link, or nothing. Must run
// AFTER rehype-sanitize — see lib/render.ts for the ordering, and this is what that position costs:
//
// `<iframe>` is not in the schema and must never be added to it (§6), so the element below is built
// where sanitize can no longer see it. That also means the `src` it carries meets no protocol check
// anywhere, exactly as the card's `<a href>` does not (link-card-requirements.md §4.4) — hence
// `resolveEmbed`, which builds the src itself from an id it has verified, and which the editor asks
// as well so that both sides accept the same references (lib/embed-provider.ts).
//
// Unlike rehypeLinkCard this stage is synchronous and takes no resolver: an embed derives everything
// it shows from the reference, so there is no table to read and nothing for a caller to inject
// (§3.2). The two passes remain, because a node can still be removed and mutating during the walk
// would renumber the indices still to be visited.
export function rehypeEmbed() {
  return (tree: Root) => {
    const found: { node: Element; parent: Root | Element; index: number }[] = [];
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'div' || !hasClass(node, 'embed')) return;
      // **The attribute is part of what this stage claims, not just of what it reads.** `embed` is
      // an ordinary word, and an author's own `<div class="embed">` — written by hand, wrapping
      // their content — would otherwise be collected and then removed outright, taking its children
      // with it. That is the outcome fallbackLink's comment calls the one nobody can debug. A node
      // this extension wrote always carries `data-href` (possibly empty, which is still removed
      // below), so nothing about the stored form changes.
      if (typeof node.properties.dataHref !== 'string') return;
      if (!parent || typeof index !== 'number') return;
      found.push({ node, parent, index });
    });
    if (found.length === 0) return;

    const replacements: (ElementContent | null)[] = found.map(({ node }, index) => {
      const href = node.properties.dataHref;
      // No reference at all: an empty `<div class="embed">` names nothing and cannot degrade to a
      // link either, so it goes.
      if (typeof href !== 'string' || href === '') return null;
      const target = resolveEmbed(href);
      // Unique within the document, which is all the provider's addressing needs. The prefix is not
      // `embed-` on purpose: that is the name X's widget gives an iframe that was handed no id at
      // all, and a collision between "the one we named" and "the ones it named itself" is the exact
      // ambiguity the id exists to remove.
      if (target) return embedElement(target, `emb-${index}`, href);
      // **The fallback is published markup too, and it is built after sanitize.** `resolveEmbed`
      // returning null says only "no provider claims this" — it says nothing about whether the
      // string is safe as an `<a href>`, and `javascript:` reaches here exactly as it reaches the
      // card's stage (link-card-requirements.md §4.4). `externalCardHost` is the check the card
      // already asks of every external reference: http(s), parseable, and carrying no credentials.
      // A reference that fails it is dropped rather than linked, which is what rehypeLinkCard does
      // with the same input.
      return externalCardHost(href) !== null ? fallbackLink(href) : null;
    });

    // Right to left within each parent, so an earlier splice cannot shift the index of one not yet
    // applied. `found` comes out of `visit` in document order, which is per-parent ascending.
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const { parent, index } = found[i];
      const replacement = replacements[i];
      if (replacement) parent.children[index] = replacement;
      else parent.children.splice(index, 1);
    }
  };
}
