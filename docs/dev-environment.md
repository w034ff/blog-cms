# 開発環境の罠と依存の扱い

開発中に踏んだ、アプリのバグに見えて実はアプリの外にある問題と、依存パッケージの入れ方・受け入れた警告の記録。数値と版は判断した時点の実測である。2026-09-24 に Claude のプロジェクト memory から移した。

## 1. Turbopack の開発用ファイルシステムキャッシュ

Next 16.1 以降、`next dev` は `turbopackFileSystemCacheForDev` を既定で有効にし、コンパイルした成果物（JS / CSS のモジュール出力）を開発セッションをまたいで dist ディレクトリに残す（`node_modules/next/dist/docs/` の `turbopackFileSystemCache.md` と `08-turbopack.md` の「Build Caching」）。

**これは Data Cache や Full Route Cache とは別の層である。** `force-dynamic` は後者を飛ばすだけで、成果物のキャッシュには何もしない。サーバ側で毎回描画し直しているページが、古いコンパイル済みの CSS やモジュールを配り続けることがある。

### 1.1 症状

- `app/globals.css` に足したクラスや色、新しく足したファイルが、公開ページに反映されない（2026-07-18）。HMR はこのキャッシュを確実には無効化しない。
- Tailwind v4 の `@theme` 変数から生まれるユーティリティは、古い CSS には存在しえない。`--container-site` から作った `max-w-site` に幅の上限を移したとき、公開ページもエディタも全幅で描かれた（2026-08-01）。組み込みのユーティリティは古い CSS にも残っているので、この非対称が手掛かりになる。force-dynamic のマークアップは新しいクラス名を出し、スタイルシートにはその規則が無く、プロパティが黙って効かない。
- E2E のサーバも同じキャッシュを持つ。CSS の変異テストで宣言を 1 つ消しても spec が緑のままで、「この宣言は効いていない」と読みかけた（2026-09-01）。最初の実行が変異前のスタイルシートを配っていただけだった。**緑のままの CSS の変異は、2 回目の実行か、規則を丸ごと消して赤になることを確かめるまで証拠にならない。**
- ルートが 404 になることもある（2026-09-20）。3 シャードの実行で、1 つのシャードだけ `GET /login` が 404ms で 404 を返し、`auth.setup.ts` が落ちた。そのシャードの残り 290 の spec は「did not run」になり、合計が 817 から 527 に落ちたのに、最後の要約には赤が 2 つしか出なかった。1 つのシャードでだけ 404 になるルートは古い dist ディレクトリであって、アプリではない。**赤の一覧を読む前に、合計を期待値と比べる。**
- 見分け方: 新しいクラス名が JS のチャンクにあって、どの `.css` にも無い（`grep -rl <クラス名> .next-e2e-*/` が `chunks/ssr/*.js` にしか当たらない）。サーバを起動せずに数秒で確かめられる。

### 1.2 直し方と順序

**サーバを止めてから dist ディレクトリを消し、起動する。** 起動中の `next dev` の下で消すと、以後のリクエストはすべて Internal Server Error になり、再起動するまで戻らない（2026-09-09 に E2E のサーバで再現。200 のあと 500 / 500 / 500）。サーバはすぐに骨組みだけのディレクトリを作り直すので、ディレクトリが戻ったことは回復の印ではない。

- 最初の失敗の唯一の記録は `<distDir>/dev/logs/next-development.log` で、同じ削除で消える。消す前に読む。
- 消せないとき（権限の確認で止まったときなど）は、新しい `E2E_PORT` で走らせる。E2E の各パスはポートで決まるので、きれいなディレクトリに一から作り、古いものには触らない。

### 1.3 起動中に 500 になる現象（未解決、2026-09-09 決定）

開発サーバが、誰も dist ディレクトリを消していないのに 500 を返し続けたことがある。ログの先頭は `Persisting failed: Unable to write SST file <n>.sst / Caused by: No such file or directory` で、続いて `Compaction failed: Another write batch or compaction is already active`、そのあとに `ENOENT … app-paths-manifest.json` などの連鎖が来る。

その日のうちに測定で外したもの: このセッションの道具（vitest、eslint、Playwright の全件実行は `.next` の inode も mtime も変えなかった）、2 つの開発サーバによる dist の共有（Next 16 は 2 つ目を拒み、1 つ目は健全なまま）、リポジトリ内の `rm`（package.json、e2e のスクリプト、`.claude/hooks` に無い）。残るのはキャッシュ層そのものである。

**決定**: キャッシュは有効のまま様子を見る。切る手段は `experimental.turbopackFileSystemCacheForDev: false` で、開発時の再構築の速さを保つためと、ログをもう一度集めるために見送った。頼まれない限り再提案しない。再発したら、まずターミナルの出力と `next-development.log` を求める。

## 2. タブの復元で「エディタを読み込み中…」のまま止まる

Chrome の「閉じたタブを開き直す」（Ctrl+Shift+T）は戻る / 進むと同じ復元の扱いで、再検証せずに HTTP キャッシュを使う。`next dev` はハッシュの付かない資産の URL を使い、HMR でモジュールグラフが変わるので、動いているサーバと合わない古い JS がハイドレーション中に throw する。PostEditor は `useEditor({ immediatelyRender: false })` の描画後の effect でプレースホルダを本物のエディタに替えるので、そこでの失敗はプレースホルダを恒久的に残す（2026-07-22 に確認）。

- 普通の再読み込みや遷移では再現しない。タブを閉じて Ctrl+Shift+T で戻したときだけ起きる。
- Ctrl+Shift+R（ブラウザのキャッシュを飛ばす）ですぐ直る。これがサーバ側の §1 ではなくブラウザの HTTP キャッシュだと決めた根拠である。
- アプリのバグではない。本番ビルドの資産は内容でハッシュされ不変なので、起きない見込みである。

## 3. SQLite のコピーは `-wal` と一緒に

`data/blog.db` は WAL モードで動いている。`cp data/blog.db` だけでは、最近の書き込みが `blog.db-wal` に残ったまま古いスナップショットをコピーする。1 つだけのコピーを開くと空の WAL が新しく作られ、コピーは黙って古い状態を読む。

2026-07-26、スクリプトの試走で `draft_content` の JSON が壊れていると判断しかけた。壊れていたのは古い値のほうで、実物は正しかった。**`blog.db`・`blog.db-wal`・`blog.db-shm` を一緒にコピーする（またはチェックポイントを取ってから）。** コピーの言うことを信じる前に、本物を `readonly: true` で読む。E2E のハーネスが better-sqlite3 の `.backup()` を使うのはこのためである。

## 4. 依存パッケージの入れ方

作者はサプライチェーン攻撃への備えを求めている（素の `npm install` を止めたことがきっかけ）。`.npmrc` が次を設定している。

- `min-release-age=7`: 公開から 7 日未満の版は入れない。npm 11.11 は `.npmrc` のこの設定を守る（新しすぎる版は `ETARGET … with a date before <date>` で失敗する。2026-08-03 に確認）。それでも CLI で `--min-release-age 7` を明示する（害は無く、`.npmrc` が無くなっても残る）。7 日未満のセキュリティ修正は入れられないので、約束する前に `npm view <pkg> time --json` で公開日を確かめ、待つか作者の了承を得る。
- `ignore-scripts=true`: インストール時のライフサイクルスクリプトを止める。信頼するネイティブ依存は明示的に作る（`npm rebuild better-sqlite3 --ignore-scripts=false --foreground-scripts`）。`npm ci` のたびにこの手順が要る。
- `save-exact=true`: `^` を付けずに版を固定する。

**規則**: 素の `npm install` をしない。承認された計画にある依存だけを入れ、それ以外（`tsx` など）は先に尋ねる。依存の無い代替を優先する（Node 24 は `.mts` をそのまま実行できるので、スクリプトに `tsx` は要らない）。入れた後は `npm audit signatures` と `npm audit` を走らせ、解決した各版の公開日が 7 日以上前であることを確かめる。

### 4.1 @tiptap の更新

`docs/editor-pitfalls.md` §4.2。

## 5. `npm audit` で受け入れた警告

### 5.1 drizzle-kit 経由の esbuild（moderate 4 件、受け入れ）

経路は `drizzle-kit`（devDependency）→ 非推奨の `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → 古い `esbuild@0.18.20`（GHSA-67mh-4wv8-2f99。esbuild の開発サーバが任意のサイトからのリクエストを許す）。2026-07-21 決定。

**受け入れる理由**: drizzle-kit は開発専用（`db:push` / `db:migrate`）で、本番のバンドルに入らない。`@esbuild-kit` は TS の drizzle 設定を実行する ESM ローダとしてだけ使われ、esbuild の HTTP サーバは起動しないので、警告の経路に届かない。前向きの修正が無い（drizzle-kit の最新版も `@esbuild-kit/esm-loader` を宣言している）。

**`npm audit fix --force` をしない。** その「修正」は `drizzle-kit@0.18.1` への大幅な格下げで、マイグレーションを壊す（postcss の項目も「修正」が `next@9.3.3` だった）。drizzle-kit が `@esbuild-kit` を外したら前へ上げる。それまでは、この経路の moderate 4 件が正常である。

### 5.2 override で持ち上げているもの

`package.json` の `overrides` は `postcss` だけを持つ。

- `postcss`: next が同梱する古い postcss の XSS（GHSA-qx2v-qp2m-jg93）を、`^8.5.15` に持ち上げて塞いだ（`422bc73`）。
- `sharp` の override は 2026-09-24 に外した。当時の next が `sharp: ^0.34.5` を宣言し、libvips の CVE を抱えた版が残るので `^0.35.3` に持ち上げていた（`7c7e554`）。next 16.3.5 は自分で `^0.35.4` を宣言するので、override は役目を終え、残すと next が先へ進んだときに sharp を引き留める。外しても解決は `sharp@0.35.4` のまま変わらない。`next/image` を import していなくても最適化のルート `/_next/image` は存在し、それが sharp を到達可能にしている。2026-09-30 からは `lib/upload-image.ts` も sharp を使うので、`package.json` の直接の依存として next と同じ版に固定している。next が sharp を上げるときは、この固定も揃えて上げる（揃えないと 2 つの版が入る）。
- 何かを override で上げるときは範囲を絞る。`brace-expansion` を丸ごと override すると、minimatch@10 が使う 5.x まで 1.x に引き下げて壊す。

### 5.3 vitest のパストラバーサル（2026-09-24 に対応）

`@vitest/mocker` 経由の moderate（Vitest: Path Traversal / Arbitrary File Read）を、`vitest` を 4.1.9 から 4.1.11 に上げて塞いだ。`npm audit` は drizzle-kit 経由の 4 件（§5.1）だけに戻った。vitest の範囲に従って、推移的依存の `vite` が 8.0.16 から 8.3.0 に、`rolldown` が 1.0.3 から 1.2.9 に上がり、`lightningcss` 1.33.0 が加わった。どれも公開から 7 日以上経っていることと、`npm audit signatures` を確かめた。

### 5.4 eslint-config-next 経由の braces（high 5 件、受け入れ）

経路は `eslint-config-next`（devDependency）→ `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces@3.0.3`（GHSA-vfj7-8cjw-p6xm。深く入れ子にしたパターンでスタックを使い切る DoS）。2026-10-05 決定。

**受け入れる理由**: lint のときだけ動き、本番のバンドルに入らない。glob パターンはプラグインと設定が決めるもので、外部の入力は届かない。前向きの修正も無い（braces の最新版が 3.0.3）。`npm audit fix --force` の「修正」は `eslint-config-next@14` への格下げなので、しない。braces か fast-glob が修正版を出したら上げる。それまでは、§5.1 の moderate 4 件とこの high 5 件、計 9 件が `npm audit` の正常な状態である。

### 5.5 next の RCE と markdown-it（2026-10-05 に対応）

- `next` の critical（GHSA-vcvr-r3jv-pc5j。`next/og` の `ImageResponse` で RCE、16.2.0〜16.3.5）を、`next` と `eslint-config-next` を 16.3.5 から 16.3.6 に上げて塞いだ。このリポジトリは `next/og` を import していないが、本番の依存なので上げた。`npm audit` が勧めた 16.3.8 は公開から 7 日未満だったので、待機期間を過ぎていた 16.3.6 を選んだ。16.3.6 も sharp に `^0.35.4` を宣言するので、§5.2 の sharp の固定は変えていない。
- `markdown-it` の moderate（GHSA-253c-mchw-3w2r。`linkify: true` のときに 2 次の処理時間がかかる）を、14.2.0 から 14.3.2 に上げて塞いだ。エディタは `linkify: false` で設定しているので届かない経路だったが、修正版が待機期間を過ぎていたので上げた。
- `brace-expansion` の high（1.1.18 → 1.1.21、5.0.9 → 5.0.12）は lockfile の更新だけで塞いだ。override は使っていない（§5.2 の最後の項目）。
- どれも公開から 7 日以上経っていることと、`npm audit signatures` を確かめた。

## 6. アップロードの掃除の定期実行（systemd user timer）

`npm run gc:uploads -- --delete` を、この WSL2 ホストで毎日 04:00（±10 分）に回す。unit は `deploy/systemd/uploads-gc.service` と `uploads-gc.timer`。スクリプトの挙動（猶予 24 時間、参照は DB の本文と `.mdx` の和）は `docs/project-status.md` の「アップロードは参照で消す」に従い、timer はそれを変えない。2026-09-30 決定。

### 6.1 入れ方

```
systemctl --user link "$PWD/deploy/systemd/uploads-gc.service" "$PWD/deploy/systemd/uploads-gc.timer"
systemctl --user enable --now uploads-gc.timer
systemctl --user list-timers uploads-gc.timer
```

`cp` ではなく `link` を使う。unit の実体が repo に一つだけ残り、`git pull` で更新が届く（変更後は `systemctl --user daemon-reload`）。外すときは `systemctl --user disable --now uploads-gc.timer`。この timer は `--delete` で回るので、有効にした後の最初の実行から本当に消す。先に `node scripts/gc-uploads.mts` の dry-run で孤児の一覧を見ておく。

### 6.2 node のパスと環境

- `ExecStart` は `npm` を経由せず、`node scripts/gc-uploads.mts --delete` を直接呼ぶ（`npm run gc:uploads` と同じ）。systemd の PATH に nvm は入らないので、`%h/.nvm/versions/node/v24.14.1/bin/node` に固定している。nvm で版を上げたら unit の 2 か所を直す。直し忘れると `203/EXEC` で失敗し、別の版で黙って動くことはない。
- `WorkingDirectory=%h/blog-cms/task`。スクリプトは `process.cwd()` から `data/uploads` と `content/posts` を決める。
- アプリは `.env` を Next 経由で読むが、スクリプトは読まない。`BLOG_DB_PATH` を `.env` に置いたホストで、スクリプトが別の DB（空の参照集合）を見て全ファイルを孤児と判断するのを防ぐため、`EnvironmentFile=-%h/blog-cms/task/.env` で渡す（`scripts/db-path.mts` の `resolveDbPath` が `BLOG_DB_PATH` を優先する）。`ExecStartPre` が解決結果を `db: <path>` として毎回ジャーナルに出す。**`db:` の行が本番の DB でなければ `--delete` の結果を信用しない。**

### 6.3 サンドボックスは採らない

`ProtectSystem=strict` + `ReadWritePaths=` は、この WSL2 の user manager で受け付けられるが効かない。`ProtectSystem=strict` の下で `data/` に空ファイルを作れた（`systemd-run --user -P -p ProtectSystem=strict -p ReadWritePaths=…/data/uploads` で確認、2026-09-30）。効かない制限を書くと制限があるように読めるので、書かない。`NoNewPrivileges=yes` だけを残す。

### 6.4 ログと失敗に気づく方法

- ログ: `journalctl --user -u uploads-gc.service`。1 回の実行は `db:`、`uploads: N file(s), M referenced …`、削除した各ファイル、`Removed …` の順に出る。
- 次回実行: `systemctl --user list-timers uploads-gc.timer`。
- 失敗: `systemctl --user --failed`。失敗の通知は出ない。スクリプトが非ゼロで終わるのは、`--delete` で DB が無いときの中止と、node の起動失敗（`203/EXEC`）。定期的に `--failed` を見る。
- user manager は WSL が動いている間だけ生きる（`Linger=no`）。止まっている間に逃した回は `Persistent=true` が起動時に実行する。
