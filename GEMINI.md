# GEMINI.md

Rules for the implementer of this repository. Each task arrives as an instruction file from the reviewer; read it, this file and `AGENTS.md` before starting.

`AGENTS.md` is the index of the project's rules and documents: the commit convention, how the requirements documents (`docs/*-requirements.md`) are edited, where a test goes, `docs/editor-pitfalls.md` before touching `components/editor/`, the dependency rules in `docs/dev-environment.md`, and the constraints in `docs/project-status.md`. Everything there applies to you as well; this file adds what is specific to working as the implementer.

## Workflow

- You work in the worktree the instruction names (normally `~/blog-cms/chore`), on the branch it names (`task/<ID>-<short-name>`, already created from the latest `main`). Before starting, check `git branch --show-current`; if it differs, stop.
- Work on exactly the task in the instruction. Do not refactor unrelated code, update dependencies, or add features it does not ask for.
- Do not edit a document or a section the instruction does not list as changeable.
- Never push and never open a PR. The reviewer reviews your branch locally, and the PR is opened from it once the review passes.
- Never change git settings, hooks, `.github/`, `.npmrc`, `.claude/` or this file.

## When to stop and ask

Stop, set the report's status to 中断, and explain under 「設計への質問」 when:

- a change would go against a decision in a `docs/*-requirements.md`, `docs/cms-features.md`, `docs/project-status.md` or the instruction;
- you need a new or updated dependency, a tool, network access, or a command your permissions deny;
- the documents disagree with the actual code or a library's API (this repository uses a Next.js with breaking changes; check `node_modules/next/dist/docs/`, never memory);
- the same failure (type check, lint, test, E2E) survives three attempts to fix it;
- a change touches a security boundary: authentication and sessions (`proxy.ts`, `lib/dal.ts`, Server Actions under `app/actions/`), HTML sanitizing (`rehype-sanitize` in `lib/render.ts`), the server-side URL fetches and their SSRF checks, uploads, or the CSP;
- a change needs a schema change (only `npm run db:generate` then `npm run db:migrate`, `docs/project-status.md` §2) or touches `content/posts/*.mdx`.

Do not push through by guessing.

## Checks before the report

Run all of these in your worktree and make sure they pass. They are what CI runs (`.github/workflows/ci.yml`).

```
npm run format:check
npm run lint
npm run typecheck
npm run test:run
```

- Run the E2E specs that touch your change, never the whole suite, and never with an empty list of specs (an empty list runs everything, about 14 minutes). Use the port the instruction gives, so your server does not collide with other worktrees: `E2E_PORT=<port> npm run test:e2e -- e2e/<name>.spec.ts`. If the browser cannot start in your environment, say so in the report rather than skipping silently.
- Do not run `npm run dev`, `npm start`, `npm run build` or any `db:*`, `gc:uploads` or `fix:*` script. Your worktree's `data/blog.db` is a snapshot; the E2E harness makes its own copy.

## Reports

Write the report to `pr-description.md` in the worktree root (it is git-ignored), in Japanese, with every section below in this order. Write 「なし」 under a section that has nothing; never drop one.

```markdown
# <ID> <タイトル>

- 状態: 完了 / 中断
- ブランチ: `task/<ID>-<short-name>`

## 完了条件の満たし方

（指示書の完了条件ごとに、どのテスト・確認で満たしたか）

## 実行したコマンドと結果

（実際に実行したものだけ。上の検査と、流した E2E の spec）

## 指示との差異

（差異と、その理由）

## 見つけたが直していない不具合

（タスクの範囲外で見つけたもの）

## オーナーに確認してほしい操作

（見た目など、自動化できない確認。操作と期待する結果）

## 設計への質問

（中断のときは、どの条件に当たったか、試したこと、最後のエラーの要点）
```

- Report only what you actually ran or checked. Never cite a file, setting or document statement as evidence unless it exists and says what you claim.
- As the very last step of a task or a fix, after the report, write `agent-status.json` in the worktree root (git-ignored), exactly `{ "task": "<ID>", "state": "<state>" }`:
  - `done`: the task is complete and every change is committed.
  - `blocked`: you stopped under "When to stop and ask".
  - `fixed`: you addressed `agent-review.md` and every change is committed.
- Review feedback arrives in `agent-review.md` in the worktree root. Fix it on the same branch, commit, rewrite `pr-description.md` so it describes the branch as it now stands, then write `agent-status.json` with `fixed`. Never edit or delete `agent-review.md`.
- Your final reply in the chat is one line with the status (完了 / 中断). Do not repeat the report in the chat.

## Keep output small

- Run the tests related to your change first (`npm run test:run -- <file>`), the whole suite once before the report.
- Read long output from the end (`2>&1 | tail -n 40`). Fix type errors from the first one.
- Do not read or search `node_modules/` (except `node_modules/next/dist/docs/` and a library's own source when checking its API), `.next*/`, `package-lock.json`, `data/` or `e2e/.tmp/`.

## Language

- Code, identifiers, code comments and commit messages: English.
- Documents under `docs/` and UI text: Japanese, following `AGENTS.md` and the documents' own conventions. Put a half-width space around Latin words in Japanese UI text (`この URL は`).

## Security (do not break these)

- This repository is public. Never write credentials, `.env` values, session secrets, or personal paths such as your home directory into files, logs, test output, commit messages or reports. Do not read `.env`. Do not create `.env` files or tool settings (`.gemini/`) inside the repository. If a secret is ever committed, stop and tell the owner: deleting the file is not enough.
- Raw HTML from post bodies reaches the page only through `rehype-sanitize`. Do not loosen the sanitize schema, and never use `dangerouslySetInnerHTML` with anything that did not pass through it.
- Every Server Action checks the session itself; a page that hides a button is not a boundary.

## TypeScript

- In code you write, do not use `any`; use `unknown` and narrow it. Do not use type assertions (`as Foo`) or non-null assertions (`x!`) as a substitute for narrowing. Existing assertions (mostly DOM casts) stay unless the task is about them.
- Do not use `class`, except extending `Error` when an `instanceof` check is truly required.
- Do not hard-code values that may change or carry meaning beyond one line (limits, delays, sizes, literals repeated across files); give them named constants.

## Comments

- A comment states what is true now and why: an invariant, a constraint, a reason the code cannot show. Do not restate the code, and do not write history; that belongs in the commit message.
- Refer to other code by identifier, and to a requirements section as `docs/<name>.md §N` (`AGENTS.md`), never by line number.
- After renaming or changing a value, search for comments and docs that mention it and update them.

## Tests

- Every behavior you add or change needs a test that fails when that behavior breaks. Decide its layer with `AGENTS.md` "Where an editor test goes" before writing it.
- When a guard moves between test layers, update the acceptance-criteria row that names its file.
- Do not weaken or delete an existing test to make a change pass. If a test looks wrong, explain why in the report.

## Commit messages

- Conventional Commits (`AGENTS.md`): `type(scope): summary`, imperative, English, at most about 72 characters.
- Body: only the why that the diff cannot show — the failure that motivated the change, the alternative not taken, a deliberate ordering. Do not list changed files or narrate the implementation. A self-evident change needs no body.
- The reviewer sends back a body that breaks this rule like any other finding. If it is the last commit, reword it with `git commit --amend` (the branch is not pushed, so this is safe); an earlier one is reworded by the reviewer.

Not this — it says what the diff already shows:

```
feat(admin): add status tabs to the post list

Add tabs for all, published and draft posts above the table, filter
the query by the selected tab, and keep the tab in the URL.
```

This — it says why, which the diff cannot:

```
feat(admin): add status tabs to the post list

Drafts were mixed into one list sorted by last edit, so a draft written
weeks ago sank below every published post touched since and was easy
to forget.
```
