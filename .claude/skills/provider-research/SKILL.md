---
name: provider-research
description: Evaluate whether a URL provider (a site whose links authors paste into posts) should be an embed, a link card, or neither, by measuring both in a real browser. Use before adding or declining a provider in lib/embed-provider.ts, or when the user asks how a site's links should render.
argument-hint: <provider name or sample URL>
---

For the provider given as $ARGUMENTS:

1. **Precedent.** Check how Zenn, Qiita and dev.to render the provider's URLs, live, not from memory.
2. **Measure the embed** with a standalone Playwright script, not the app and not curl: does the iframe load off-origin, `X-Frame-Options` / `frame-ancestors`, whether it reports its height (postMessage) or needs a fixed box, the third-party request count, and mobile tap behaviour. The technique and its traps are in `probe-technique.md` next to this file; read it first.
3. **Measure the card**: can the server fetch the page's OGP at all (403, a bot challenge, JS-only metadata), and does the answer change with the User-Agent (a crawler UA versus a browser UA)? Here a plain fetch is the right tool, because it is what the card does.
4. **Believe no negative until it survives the traps in `probe-technique.md`** — batched frames, headless-only bot walls, frames scrolled out of view, and "no error text" mistaken for "it runs" have each produced a wrong refusal here.
5. **Unreachable docs.** If the provider's documentation is blocked or JS-only, read its docs source repository on GitHub instead.
6. **Report raw measurements before any conclusion**, then recommend embed, card, or neither, with the trade-offs. STOP and wait for my decision.
7. **After the decision**, record it in `docs/embed-requirements.md` as a new section at the end, with the fixture URLs and the numbers next to the conclusion they justify. Never renumber existing sections (see AGENTS.md). Probe scripts stay in the scratchpad and are not committed.
