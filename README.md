# Blog CMS

SQLite をバックエンドに持つ自作のブログ CMS。公開側は Markdown を unified パイプラインで HTML に変換して配信し、管理側はブラウザ上の TipTap WYSIWYG エディタで記事を書く（保存形式は Markdown のまま）。

- 公開: `/`（記事一覧）、`/posts/[slug]`、`/tags/[tag]`、`/categories/[category]`
- 管理: `/admin`、`/admin/posts/new`、`/admin/posts/[id]/edit`（`/login` で認証）

## 必要なもの

- Node.js 24 系（`.nvmrc`。動作確認は v24.14.1）
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

| 変数                              | 用途                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ADMIN_USERNAME` `ADMIN_PASSWORD` | `npm run db:seed` が作る管理者ユーザーの資格情報                                                         |
| `SESSION_SECRET`                  | セッション Cookie（JWT）の署名鍵。十分に長いランダム文字列                                               |
| `SESSION_COOKIE_SECURE`           | HTTPS が前に立つ環境では `true`、LAN/HTTP では `false`                                                   |
| `SITE_ORIGIN`                     | 公開オリジン（例 `https://blog.example.ts.net`）。省略時は `http://localhost:3001`。**公開環境では必須** |
| `SITE_INDEXABLE`                  | `true` のときだけ検索エンジンに開放する。省略時は **noindex**                                            |
| `BLOG_DB_PATH`                    | DB ファイルの場所を上書きする。省略時は `data/blog.db`                                                   |

`SITE_INDEXABLE` が既定で off なのは、暫定のホスト（LAN、Tailscale Funnel の `*.ts.net`）が索引されると、本番ドメインへ移った後もそこへ人を送り続けるためで、取り消しは第三者への申請になる。恒久的な URL が決まってから `true` にする。切り替えにはビルドと再起動が必要。

`SITE_ORIGIN` は絶対 URL を要求し、不正な値ならサーバー起動時に落ちる（localhost に暗黙で退行すると、共有カードの URL が読者自身の PC を指したまま気づけないため）。`https` を指定して `SESSION_COOKIE_SECURE` が `true` でない場合は警告が出る。

### 3. データベース

```bash
npm run db:migrate         # drizzle/ のマイグレーションを流してテーブルを作成
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
| `npm run db:generate`        | `lib/db/schema.ts` の変更から `drizzle/NNNN_*.sql` を生成                                          |
| `npm run db:migrate`         | 未適用のマイグレーションを DB に適用                                                               |
| `npm run db:baseline`        | 既存 DB を「適用済み」として台帳に記録（初回のみ。既定はドライラン）                               |
| `npm run db:backup`          | `VACUUM INTO` でスナップショットを取得（`data/backups/`）                                          |
| `npm run db:seed`            | 管理者ユーザーの作成                                                                               |
| `npm run db:migrate-content` | `content/posts/*.mdx` の取り込み                                                                   |
| `npm run gc:uploads`         | 未参照の `data/uploads` を掃除（既定はドライラン。`-- --delete` で実削除）                         |
| `npm run fix:glued-images`   | 過去の書き出しバグで画像行に貼り付いた記法を修復（既定で DB を書き換えるので `-- --dry-run` から） |

## テスト

- **ユニット/結合**: `npm run test:run`。vitest（Node 環境）で、レンダリングパイプラインや DB 書き込みまわりを対象にする。
- **E2E**: `npm run test:e2e`。エディタはブラウザ上でしか挙動を確認できないので、Playwright で実物を操作する。専用ポート・専用ビルドディレクトリ（`.next-e2e`）・シードした DB のコピーを使うので、`npm run dev` を動かしたままでも並行して実行できる。

## スキーマを変更するとき

`lib/db/schema.ts` を編集したら、生成したマイグレーションを適用する。**`drizzle-kit push` は使わない**（後述）。

```bash
npm run db:generate   # drizzle/NNNN_*.sql を生成
                      # 生成された SQL を必ず読む — これがそのまま実行される
npm run db:backup     # 適用前のスナップショット
npm run db:migrate    # 適用
```

適用済みかどうかは DB 内の `__drizzle_migrations` で管理される。判定は「記録済みの最新の `created_at` と各マイグレーションの `when`（`drizzle/meta/_journal.json`）の比較」で、SQL のハッシュ照合ではない。

`drizzle/0000_*.sql` は既存の DB を作り直すためのものではなく、その DB の**現状を写したベースライン**。手元の DB には `db:baseline` を**一度だけ実行済み**で（台帳に行があると再実行は拒否される）、そのため `db:migrate` は何もしない。空の DB では 0000 から順に流れて同じ構造になる（この一致は実際に突き合わせて確認済み）。`db:baseline` の出番は、マイグレーション導入前に作られた別の DB を後から取り込むときだけ。

## リポジトリの約束

- **`content/posts/*.mdx` を消さない。** `data/` は gitignore なので、この MDX がバージョン管理された唯一の本文であり、`db:migrate-content` の入力でもある。消すと DB の中だけに本文が取り残される。
- **ブランチ**: `main` の 1 本。作業はブランチを切って PR で `main` に入れる。PR では CI（`.github/workflows/ci.yml`）が整形・lint・型・ユニットテストを検査する。E2E は CI に入れず、マージの前に手元で流す。
- **コミット**: Conventional Commits（`AGENTS.md` を参照）。
- **依存追加**: `.npmrc` にサプライチェーン対策の設定（`min-release-age` / `save-exact` / `ignore-scripts`）が入っている。理由はファイル内のコメントを参照。

## 補足

- **`drizzle-kit push` は意図的に廃止した**（`db:push` スクリプトも削除済み）。push は稼働中の DB と `schema.ts` を突き合わせ、SQLite がその場で `ALTER` できない変更ではテーブルを作り直す（新規作成 → コピー → DROP → リネーム）。`posts` に対してはユニークインデックスを二重に発行して途中で abort するため、中身の入った DB では危険な操作になる。push と migrate の併用自体が事故のもとなので、経路は `db:migrate` に一本化している。
- まだデプロイしていない。当面は LAN 内での運用を想定していて、リバースプロキシや systemd の設定はリポジトリに含まれていない。
