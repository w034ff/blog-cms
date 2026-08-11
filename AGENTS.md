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
