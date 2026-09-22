<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Commit convention

This repo uses **Conventional Commits** (adopted 2026-06-23). Subject: `type(scope): summary` in the imperative — e.g. `feat(editor): add drag-and-drop image upload`.

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- Scope is optional. Breaking changes use `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer.
- Subject language: English (matches existing history).
- Commits before this date (e.g. `eadb191` and the initial commits) predate the convention and are intentionally left unprefixed — do not retro-rewrite them.

# Requirements documents (`docs/*-requirements.md`)

These are design records, kept and maintained after the feature ships. They are load-bearing: **307 code sites cite a section number (299 of them comments, the rest test names), and 273 cite it without naming the file.** That makes the numbering an API, and it is why these rules constrain new material instead of asking for a reorganisation.

- **Never renumber, merge, or split an existing section.** Additions go at the end of the document, or as a new sub-number under the section they belong to. When several sub-sections turn out to answer one question, add an index table at the head of the group rather than consolidating them — `docs/accordion-requirements.md` §6.5 is the precedent.
- **Write the body in the present tense.** When a decision is reversed, rewrite the passage to say what is true now, and keep one or two lines for the reason and the date. Do not leave the superseded claim standing with a correction stacked on top of it — that layer, not the subject matter, is what made these documents large.
- **Strikethrough is re-derivation insurance, not a changelog.** Keep it only when a reader who did not see the measurement could plausibly reach the now-false answer on their own (`docs/link-requirements.md` §9's first item is the shape that earns it). Otherwise delete the superseded text; git has it.
- **A resolved TODO becomes a row in the acceptance-criteria table**, not a struck-through bullet with the answer appended to it.
- **Bold is scarce — about one span per 200 characters** (measured 2026-08-11: the five documents sit at 9.4–13.0% of body characters). Use it for a section's verdict, an inline pseudo-heading (`決定` / `理由` / `機構`), a prohibition, or the lead of a list item. Do not bold a sentence that is already the only claim in its paragraph, and do not bold every row of a table column — a column that is entirely bold marks nothing.
- **A citation into `node_modules` carries a grep-able identifier, not just a line number** — a function name, a literal expression, a `PluginKey` name. Line numbers into `dist/` rot silently on the next dependency bump, and a bump of the `@tiptap` family is a recurring operation here. Quote the identifier as it appears in `dist/`, which is minified in places (`priority: 1e3`, not `priority: 1000`).
- Body language is Japanese, matching the existing documents.

# Where an editor test goes

The E2E suite is **701 of the suite's 759 cases and 86% of its wall clock**, and its floor is the navigation: the fastest spec in it takes 1.4s against a 2.3s median, so most of a spec is preamble rather than claim (measured 2026-09-11). The same claim as a vitest case over the editor's schema costs about a millisecond. So the question below is asked before the test is written, not after.

**Can the claim be written against a `Slice`, a content expression, or a markdown string?** If it can, it is a vitest case under `components/editor/`, built on `components/editor/test-schema.ts` (`schema`, `para`, `docOf`, `nodeSlice`, `rangeSlice`, `tableFixture`). A spec in `e2e/` is for what only a browser answers: input rules, keymaps, NodeViews, geometry and CSS, IME composition, a real drag (an in-editor drag never fires `dragstart` under CDP), the clipboard, autosave, publish, and the round trip through the form.

- **Slices come from a real selection** — `nodeSlice` / `rangeSlice`, not `new Slice(…)`. A hand-built triple that happens to agree with the gesture proves nothing about the gesture, and a two-argument fixture once made a whole suite vacuous without failing anything. Assert a slice's open depths before a test leans on it. Building them by hand is right only where the file's subject _is_ the shape space rather than one gesture — `components/editor/details-title-slice.test.ts` is that case, and says so.
- **The schema comes from `postEditorExtensions`, never a list re-written in the test.** A hand-picked array passes precisely when what PostEditor registers is the thing that changed; `components/editor/draggable-types.test.ts` is where that argument was first made.
- **The vitest case owns the predicate, the spec owns the wiring.** When both layers are genuinely needed, the spec shows the guard is installed on each route it has to cover — not the predicate's whole table repeated in a browser at 1.8s a row.
- **Moving a guard between layers moves its acceptance-criterion row too.** The tables in `docs/*-requirements.md` name the file that measures each criterion, so a guard that changes layer leaves that row false until it is updated.
