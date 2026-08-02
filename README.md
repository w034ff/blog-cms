# Blog CMS

SQLite をバックエンドに持つ自作のブログ CMS。公開側は Markdown を unified パイプラインで HTML に変換して配信し、管理側はブラウザ上の TipTap WYSIWYG エディタで記事を書く（保存形式は Markdown のまま）。

- 公開: `/`（記事一覧）、`/posts/[slug]`、`/tags/[tag]`、`/categories/[category]`
- 管理: `/admin`、`/admin/posts/new`、`/admin/posts/[id]/edit`（`/login` で認証）

## 必要なもの

- Node.js 24 系（動作確認は v24.14.1）
- Google Chrome — E2E テストがシステムの Chrome を使う（Playwright のブラウザは同梱しない設定）

## セットアップ

### 1. 依存関係

```bash
npm ci
npm rebuild better-sqlite3 --ignore-scripts=false --foreground-scripts
```

**2行目は必須。** `.npmrc` で `ignore-scripts=true` にしているため、`npm ci` だけではネイティブモジュールの better-sqlite3 がビルドされず、起動時に落ちる。

### 2. 環境変数

リポジトリ直下に `.env` を置く（項目は `.env.example` を参照）。

| 変数                              | 用途                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| `ADMIN_USERNAME` `ADMIN_PASSWORD` | `npm run db:seed` が作る管理者ユーザーの資格情報           |
| `SESSION_SECRET`                  | セッション Cookie（JWT）の署名鍵。十分に長いランダム文字列 |
| `SESSION_COOKIE_SECURE`           | HTTPS が前に立つ環境では `true`、LAN/HTTP では `false`     |
| `BLOG_DB_PATH`                    | DB ファイルの場所を上書きする。省略時は `data/blog.db`     |

### 3. データベース

```bash
npm run db:push            # 空の DB にテーブルを作成
npm run db:seed            # 管理者ユーザーを作成（ADMIN_USERNAME / ADMIN_PASSWORD）
npm run db:migrate-content # content/posts/*.mdx を DB に取り込む
```

DB の実体は `data/blog.db`。`data/` は gitignore されているので、クローン直後は必ずこの3つを実行する。

## 開発

```bash
npm run dev
```

http://localhost:3001 で起動する（3001 なのは、3000 を別のローカルプロジェクトが使っているため。`npm start` も同じポート）。

## スクリプト

| コマンド                     | 内容                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev`                | 開発サーバー（ポート 3001）                                                                        |
| `npm run build` / `start`    | 本番ビルド / 本番起動（ポート 3001）                                                               |
| `npm run lint`               | ESLint                                                                                             |
| `npm run format`             | Prettier で書き換え（`format:check` は確認のみ）                                                   |
| `npm test` / `test:run`      | vitest（watch / 1回）。`e2e/` は対象外                                                             |
| `npm run test:e2e`           | Playwright E2E                                                                                     |
| `npm run db:push`            | drizzle-kit push（スキーマ反映）                                                                   |
| `npm run db:seed`            | 管理者ユーザーの作成                                                                               |
| `npm run db:migrate-content` | `content/posts/*.mdx` の取り込み                                                                   |
| `npm run gc:uploads`         | 未参照の `public/uploads` を掃除（既定はドライラン。`-- --delete` で実削除）                       |
| `npm run fix:glued-images`   | 過去の書き出しバグで画像行に貼り付いた記法を修復（既定で DB を書き換えるので `-- --dry-run` から） |

## テスト

- **ユニット/結合**: `npm run test:run`。vitest（Node 環境）で、レンダリングパイプラインや DB 書き込みまわりを対象にする。
- **E2E**: `npm run test:e2e`。エディタはブラウザ上でしか挙動を確認できないので、Playwright で実物を操作する。専用ポート・専用ビルドディレクトリ（`.next-e2e`）・シードした DB のコピーを使うので、`npm run dev` を動かしたままでも並行して実行できる。

## リポジトリの約束

- **`content/posts/*.mdx` を消さない。** `data/` は gitignore なので、この MDX がバージョン管理された唯一の本文であり、`db:migrate-content` の入力でもある。消すと DB の中だけに本文が取り残される。
- **ブランチ**: `main` が安定版、`develop` が統合ブランチ。作業は `develop` に入れ、区切りで `main` へマージする。
- **コミット**: Conventional Commits（`AGENTS.md` を参照）。
- **依存追加**: `.npmrc` にサプライチェーン対策の設定（`min-release-age` / `save-exact` / `ignore-scripts`）が入っている。理由はファイル内のコメントを参照。

## 補足

- 既存の `posts` テーブルに対する `db:push` は drizzle-kit 側の不具合で失敗するため、稼働中の DB へのスキーマ変更は手書きの `ALTER TABLE` で行っている。空の DB に対する push は動くので、上のセットアップ手順には影響しない。
- まだデプロイしていない。当面は LAN 内での運用を想定していて、リバースプロキシや systemd の設定はリポジトリに含まれていない。
