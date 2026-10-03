# プロジェクトの状態と先送りの一覧

このブログ（DB を持つ CMS と TipTap のエディタ）の、コードからは読み取れない制約・経緯・運用と、先送りにした作業の記録。機能ごとの設計は `docs/*-requirements.md` と `docs/cms-features.md` にある。2026-09-24 に Claude のプロジェクト memory から移し、今のコードと照合した。

## 1. 概要

- 静的な MDX のサイトを、DB を持つ CMS とブラウザのエディタに作り替えた（2026-06-23、`eadb191`）。ブランチは `main`（安定）と `develop`（統合）の 2 本。
- SQLite（`better-sqlite3` + `drizzle-orm`、`data/blog.db`）。公開ページは `lib/render.ts` の unified のパイプラインで markdown を HTML にし、生の HTML は `rehype-sanitize` で消毒する。
- 認証は JWT の cookie で、14 日のスライディング（`proxy.ts` が再発行、`SESSION_MAX_AGE_SECONDS`）。ログインには回数の制限がある（`lib/login-throttle.ts`）。
- エディタは `/admin/posts/new` と `/admin/posts/[id]/edit` の TipTap（2026-06-29、`f39c2d7`）。**保存形式は markdown のまま**で、エディタを替えても `lib/render.ts` と保存の経路は変わらなかった。

## 2. 守る制約

- **`content/posts/*.mdx` を消さない。** `data/` は gitignore されているので、`.mdx` は記事の内容の唯一のバージョン管理された写しで、`scripts/migrate-content.mts` の種でもある。消すと内容が追跡されない DB に取り残され、新しいクローンで種を入れ直せなくなる。
- **スキーマの変更はマイグレーションだけで行う。** 経路は `db:generate` → `db:migrate` だけで、`db:push` は 2026-08-02 に package.json から消した。再び足さない。drizzle-kit 0.31.10 の push は `posts` をその場で変えられず、テーブルを作り直す経路で `CREATE UNIQUE INDEX posts_slug_unique` を 2 回出して途中で止まった。スキーマと DDL が一致していても起きる。`posts` に列を足すときは最後に置く。手順は `npm run db:backup && npm run db:migrate`。
- **マイグレーションの基点は、その時点のスキーマである**（2026-08-02、`cd9b5b3`）。過去に手で当てた `ALTER` は `.sql` として残っていないので、歴史を再構成しなかった。`scripts/baseline-db.mts` は台帳を書く前に、ジャーナルをメモリ上の DB に再生して `sqlite_master` を正規化して比べ、食い違えば拒む。drizzle-orm の適用済み判定は `created_at` の比較だけで、ハッシュを見ない。CLI の `drizzle-kit migrate` が同じ判定かは確かめていない。
- DB のパスは `scripts/db-path.mts` が一か所で決める。`BLOG_DB_PATH` を設定したホストで、スクリプトが別の DB に書いて成功と報告するのを防ぐため（`f2aa2ee`）。
- **アップロードは参照で消す。** `data/uploads` のファイル名はバイト列の SHA-256 で、同じ画像は 1 つのファイルを共有する。1 つのファイルが複数の記事を支えうるので、削除は参照の走査で決める。記事を消してもファイルは消えない。掃除は猶予付きの手動のスイープ `npm run gc:uploads`（既定は dry-run、`--delete`、`--grace-hours=N`、既定 24 時間。参照は DB の本文と `.mdx` の和）。
- `npm ci` の後は `npm rebuild better-sqlite3 --ignore-scripts=false --foreground-scripts` が要る（`docs/dev-environment.md` §4）。

## 3. 決定の理由（コミットの件名からは読めないもの）

- **識別子と slug は別である。** `posts` の主キーは `id` で、`slug` は null 可の UNIQUE。エディタと管理画面は `id` で、公開側は `slug` で記事を指す。slug は作成時に `crypto.randomBytes(10)` から作る 20 文字の 16 進（`lib/slug.ts`）で、表示も編集もせず、公開でも変えない。日本語の題名は slug にすると空になるので、読める URL の利点は小さい。以前の読める URL は転送なしで切った（作者の判断）。**手入力の slug 欄を戻さない。** null 可のままなのは、締めるとテーブルの作り直しが要るため。
- **保存と公開は別である。** 編集はデバウンスして `POST /api/drafts` に自動保存する。未公開の記事は通常の列に、公開済みの記事は非公開の `posts.draft_content` の JSON に書くので、公開ページは「投稿」まで動かない。Ctrl/⌘+S は自動保存を即時に流す。
- セッション切れでエディタから追い出さない。記事の Action は `getOptionalSession()` と `PostFormState.sessionExpired` を使い、書きかけを捨てずに再ログインへのリンクを出す。
- アップロードした画像に alt を付けない（`components/editor/useImageUpload.ts`、2026-09-08）。以前はファイル名から作っていたが、alt を編集する手段が無く、実際の本文画像の alt はアップロードの sha256 になっていた。読み上げられるハッシュは無音より悪く、埋まった alt は考えて書いたものと区別できない。空の alt は Zenn の本文画像でも多数派である（標本 89 枚中 55 枚。alt を持つ 34 枚にファイル名の痕跡は無い）。
- **アップロードした画像は保存の前に最小限だけ加工する**（`lib/upload-image.ts`、2026-09-30）。EXIF・XMP・IPTC・PNG のテキストを落とし、EXIF の向きを画素に焼き込み、長辺が 2000px（`MAX_IMAGE_EDGE`）を超えれば縮める。形式は変えない。落とすもの・縮めるものが無い画像と、GIF・アニメーションは元のバイト列のまま保存する。理由は、スマホの写真の位置情報がそのまま公開されていたことと、Retina のスクショが列幅（768px）の数倍の大きさで配られていたこと。形式を変えないのは、スクショの文字を非可逆の再圧縮でにじませないため。ファイル名のハッシュは保存するバイト列から取るので、加工前に保存された画像を上げ直すと、加工した別のファイルになる。WebP への変換や `srcset` の複数サイズは採らなかった（§6）。
- `rehype-sanitize` は `rehype-raw` と `rehype-pretty-code` の間にある。著者の HTML を消毒し、ハイライタの span とインラインのスタイルは許可リストに足さずに済む。
- TipTap を Milkdown と Lexical より選んだ（周辺・UI・成熟度）。TipTap には公式の markdown パッケージが無く、`tiptap-markdown` を使う。往復で変わるのは段落内のソフト改行が空白で 1 行につながることだけで、描画は同じになる。エディタのコードブロックは Shiki で色付けしない（公開側はする）。
- ツールバーのショートカット表記は、インストールされた拡張から読む。リストや水平線の拡張は既定のキーを持たないので、記憶から書かない。
- GitHub 形式のコールアウトは 3 段（情報 / 警告 / 注意）だけ。`lib/remark-github-alerts.ts` が mdast の文字で判定する（エディタの `\[!NOTE\]` のエスケープを生き延びる）。消毒のスキーマは、値を限った `className` の許可リストで広げ、`style` は通さない。見出しのアイコンは CSS の `mask-image` で、インラインの `<svg>` にしない。
- **見送った書式**（新しい理由なしに再提案しない）: 下線、文字色、文字の大きさ、見出しの下線や罫線、Zenn の `:::message` を保存形式にすること。色と大きさは markdown に表現が無く、`rehype-sanitize` が `style` を消すので、公開ページで消える。
- インラインコードのボタンは外した。入力ルール（`` `…` ``）と `Mod-E` で足りる。
- **見た目の約束事は `app/globals.css` の変数に集めてある**（2026-09-30）。書体は IBM Plex Sans JP と IBM Plex Mono（`app/layout.tsx`）、角は 2px、主ボタンは墨の塗りの `.button-primary`。色は作者のパーソナルカラー（紫・オレンジ・緑）から作った: ライトの地は薄い紫（`#f3eef8`）、タグの札は一段濃い紫（`.tag-chip`）、カテゴリ名の前の点は技術記事がオレンジ・ブログが緑（`.category-mark`）、見出し・強調・目次の選択中の項目は赤紫寄りのえんじ（`--accent`、明 `#9f1239` / 暗 `#ec7a92`）。記事の枠・目次・エディタの本文・入力欄は白い `--surface` を敷く。ダークの地は `#0a0a0a` のまま（紫に寄せても見分けがつかなかった）。それまでは Geist と OS 任せの日本語、GitHub Primer の赤、黒い角丸ボタンという既製品の組み合わせに見え、日本語の書体は 1 つも指定していなかった。書体・地・札・アクセントの候補はそれぞれ実際の画面で撮って比べ、作者が選んだ。次の 4 つは採らない。アクセントの藍（強調がリンクの青と見分けにくい、`docs/link-requirements.md` §7.1）。アクセントを警告の囲み枠と同じ色にすること（見直しの出発点が、大事な箇所と危険な箇所の赤が同じだったことである。警告は赤 `#cf222e` のまま）。オレンジや緑を本文や札に使うこと（注意の琥珀や「保存済み」の緑と意味が紛れる）。主ボタンをアクセントの色にすること（削除の赤と紛れる）。地が白でなくなったので、地の上に直接置く補足の灰色の文字は `zinc-500`（紫の地で 4.23:1）ではなく `zinc-600`（6.77:1）にしている。白い面の上のダイアログや吹き出しは `zinc-500` のままでよい。

## 4. 公開ページ

- **目次は最後に集める。** `rehype-sanitize` の `clobberPrefix: 'user-content-'` がすべての id を書き換えるので、`lib/rehype-collect-toc.ts` は消毒の後で id を読む。`lib/rehype-clobber-fragment-links.ts` はフラグメントの href に同じ書き換えを無条件にかける。
- `useActiveHeadingId` は `IntersectionObserver` ではなく、rAF で間引いたスクロールのリスナーである。IO は「交差しない → 交差しない」の移動を何も報告しないので、帯を一気に飛び越すと強調が古いまま残った。毎回 `getBoundingClientRect().top` から導き直し、覚えない。
- `--breakpoint-toc` と `toc:` の変種は、グリッド・モバイルで隠す・デスクトップで出すの 3 か所の唯一の源である。1 か所だけ動かすと、目次が二重になるか、どこにも出なくなる。サイトの箱 `--container-page` は本文と目次を合わせた幅で、境目では切り替えない（`docs/toc-requirements.md` §6.1）。レイアウトは `docs/editor-pitfalls.md` §17.2 のグリッドで、`position: fixed` のレールは作者が退けた。
- `html` に `scrollbar-gutter: stable` を付けている。付けないと、スクロールバーの要る長いページは幅が狭くなり、中央寄せのレイアウト全体が動く。スクロールを止めるモーダル（エディタのドロワーやダイアログ、画像の拡大）を開いたときも、スクロールバーが消えた分だけ画面が横にずれる。代わりに、スクロールの要らない短いページでは確保した幅が空白として残り、ヘッダの下線がその手前（約 15px）で途切れるのを受け入れる。2026-09-29 に一度外したが、モーダルを開くだけでずれるようになったので 2026-09-30 に戻した。
- 本文の幅は `max-w-3xl` のままにし、`#post-body` に背景と枠を付けた（参考サイトは 760〜781px で、この サイトは 768px だった）。
- **OGP**: Next はページが `openGraph` を設定するとレイアウトのものを丸ごと置き換える（マージしない）ので、どのページも `app/shared-metadata.ts` の `sharedOpenGraph` を展開する。`og:title` は `title` に従わない。サイト全体で 1 枚の `public/og.png` を `scripts/make-og-image.mts` が本物の Chrome で撮って commit している。記事ごとの `ImageResponse` は、CJK のフォントを渡す必要があり（手元の唯一のフォントは 9.6MB で、サブセット化の道具が無い）見送った。Slack のプレビューは robots.txt を守らない（X と Facebook のデバッガは守る）。

## 5. 運用（Tailscale Funnel、2026-08-02 から公開中）

- 公開 URL は `https://blog.example.ts.net`。今は Funnel、後で Cloudflare Tunnel + ドメインに移る（Tunnel は無料だがドメインの購入が要る）。
- アプリは WSL2（NAT）で動く。Tailscale を Windows 側に入れると、Funnel はアプリに届かなかった（502）。WSL の中に Tailscale を入れ、`tailscale up --hostname=blog --operator=$USER` で同じネットワーク名前空間に置く。`tailscale funnel 3001` は前景で動き、端末を閉じると消える。常時は `tailscale funnel --bg 3001`。
- 公開できたかは tailnet の外から確かめる。作者のブラウザは tailnet 上にあるので区別できない。
- 本番ビルド（`npm run build` + `npm start`）で動かす。`.env` に `SITE_ORIGIN` と `SESSION_COOKIE_SECURE=true` が要る。`SESSION_COOKIE_SECURE` はホストではなく経路に従う（平の HTTP で試すなら `false` にしないとログインが黙って失敗する）。`.env` は Claude からは読めない。
- **noindex は有効**（`de269fc`）。`SITE_INDEXABLE` は明示的に入れる設定で、robots.txt は `Disallow: /`。恒久のドメインに移ったときだけ外す。
- Cloudflare に移るときにすること: `/admin` の前に Cloudflare Access（Google を IdP にでき、リダイレクト先が `<team>.cloudflareaccess.com` なのでサイトのホスト名が変わっても動かない）。リバースプロキシが別のホスト名で前に立つと、Server Actions のオリジン検査が POST を拒むことがあるので、`node_modules/next/dist/docs/` で許可するオリジンの設定を確かめる。
- CSP の `frame-src` は、Cloudflare に移るとき（埋め込みのラッパー方式と一緒）に決める（2026-08-31、作者の決定）。今は生の `<iframe>` を `rehype-sanitize` が消すので、ページ上の iframe は `rehypeEmbed` が消毒の後で組んだものだけで、`frame-src` が守るのは解決段の将来のバグである。罠が 2 つある。① 許可リストをプロバイダの `hosts` から作らない（ページのホストで、`src` のホストではない。導出元は `lib/embed-provider.ts` の `src`）。② gist は `srcdoc` で、親の CSP を継承する。後から `script-src` を足すと gist が壊れる（`docs/embed-requirements.md` §18）。

## 6. 先送りの一覧

- **アップロードの掃除の定期実行**: WSL2 の systemd user timer で設定済み。置き場所と入れ方は `docs/dev-environment.md` §6（`deploy/systemd/`）。Cloud Run などへ移るときは再検討する（systemd の timer は使えず、Cloud Scheduler + Cloud Run Job 等になり、`data/uploads` の置き場所も再設計になる）。
- **`npm run fix:glued-images` を本番の DB に走らせていない**（2026-07-27 時点）。直列化のバグは源で直っている（`d6ccaf8`）が、それ以前に保存した記事には、画像の行に引用やフェンスがくっついて文字として描かれるものが残りうる。先に `-- --dry-run`、サーバを止めてから。正規表現はフェンスの中を飛ばさないので、dry-run の出力を確かめる。
- **自動保存の手元のバッファ**: 自動保存はサーバ側だけで、次の保存が成功するまで編集は React のメモリにしかない。回線断やセッション切れで差分を失いうる（`sessionExpired` の案内と `beforeunload` で和らげている）。作者が先送りにした。サーバ側の自動保存が主であることは正しい。
- **「変更を破棄」と、より豊かな「下書き保存」**: 作者が先送りにした。
- **レスポンシブの見直し**（2026-06-28 に提起）: サイトの見出し（ブランドと 3 つのリンクが 1 行）は 360px 前後で窮屈になりうる。手を付けていない。
- **記事の検索**（2026-06-29 に提起）: 記事が数十件になるまで早い。作るなら、既存の SQLite に対するサーバ側の `LIKE %q%`（日本語でも動き、スキーマの変更が要らない。FTS5 の既定のトークナイザは日本語の語境界を扱えない）、公開済みの記事だけ（`draft_content` は見ない）、クライアント側の索引は使わない。
- **コード化の右クリックメニュー**（2026-07-01）: 入力済みの選択にインラインコードを当てる手段。空の選択の右クリックはブラウザ既定のメニューに通す。TipTap にはコンテキストメニューの部品が無いので、`editor.view.dom` の `contextmenu` と `toggleCode()` で作る。`Mod-E` が既にキーボードの利用者を覆っている。
- **画像の無い記事のカード**（2026-09-24）: 文字だけの記事は一覧やカードに何も出ない。作者の答えはサイト側で持つタイトル入りのカードで、一覧とリンクカードは HTML / CSS で描き、og:image は `/og.png` のままにする。経緯は `cms-features.md「見送り・現状維持の決定」§4`。
- **記事の設定に現在の説明文を出す**（2026-09-30）: TL;DR の文か本文からの自動抜粋か、その出所と 120 字で切れたかを設定ドロワーで見せる案。公開後に記事一覧のカードで確かめられるので見送った。残るのは、公開前に説明文を確かめられないことと、TL;DR が切れたことに書いている間は気付けないこと（`docs/summary-requirements.md` §4・§3.4）。
- **本文画像の配信の最適化**（2026-09-30）: WebP への変換、幅違いの複数版と `srcset`、原本の保持。保存形式（`![alt](src)`）に `srcset` や寸法を書く場所が無いので、描画・エディタ・`gc:uploads`・既存画像の移行にまで波及する。記事あたり画像 1 枚程度の今は見合わないとして、作者が最小構成（§3）を選んだ。転送量や表示速度が実際に問題になったら見直す。
- **`data/blog.db.bak-20260625-152304`**: 出所の分からない `cp` 形式のファイルで、WAL のもとでは古いスナップショットでありうる（`docs/dev-environment.md` §3）。バックアップとして扱わない。

## 7. 複数の著者（設計済み、一部だけ実装）

2026-06-24 に作者と設計を確かめ、実装は先送りにした。描画は既に XSS に対して安全（`rehype-sanitize`）で、残るのは認証と所有である。

### 7.1 決めたこと

- 著者は Google でログインする（OAuth2 / OIDC）。管理者はユーザー名とパスワードのまま（管理者が締め出されないため。Google の OAuth のリダイレクト URI は localhost 以外 HTTPS が必須で、平の LAN / HTTP では使えない）。
- 役割は `admin` と `author`。記事の編集と削除はその著者か管理者。管理者はすべての記事・利用者・参加方針を扱う。
- 著者になれる条件は実行時に切り替えられる: `open`（どの Google アカウントでも）と `allowlist`（許可したメールだけ）。
- 閲覧は公開のまま（下書きは公開側で 404 のまま）。
- 利用者のモデル（2026-09-24 に確認）: 読者は読むだけ、著者は自分の記事を書く、管理者は他人の記事の削除と著者の BAN もできる。**BAN はまだ設計していない**（許可リストから外しても新しいログインが止まるだけなので、停止の旗をログインと各 Action で確かめる必要がある）。
- 費用は 0 の見込み（`openid` / `email` / `profile` だけなら請求アカウントも審査も要らない）。Google Cloud の OAuth クライアントの作成と `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` の設定は作者が行う。

### 7.2 実装済みのもの（2026-09-24）

`users.role`（`admin` / `author`、既定は author。`drizzle/0012_user_role.sql` が既存の行を admin にする）と、`lib/dal.ts` の `isAdmin` / `verifyAdmin`。役割は検査のたびに DB から読み、JWT には入れない（下の設計の「`SessionPayload` に role を足す」はこれで置き換わった）。最初の利用者は `/admin/tags` の管理者限定（`docs/editor-requirements.md` §12.33.1）。

### 7.3 設計の骨組み（作るとき）

- **スキーマ**（`db:generate` → `db:migrate`）: `users` に `email`（unique、null 可）、`googleSub`（unique、null 可）、`passwordHash` を null 可に。`posts` に `authorId`（users.id への FK、既存の行は管理者で埋める）。`appSettings(key, value)` に `authorAccessMode`（既定 `allowlist`）。`authorAllowlist(email)`。
- **OAuth の流れ**: `app/auth/google/route.ts`（認可、state と PKCE の cookie）と `app/auth/google/callback/route.ts`（state の検証、コードの交換、`id_token` の検証、`email_verified` の要求、方針での絞り込み、利用者の upsert、既存の `createSession`）。Route Handler・cookie・リダイレクトの API は `node_modules/next/dist/docs/` で確かめる。
- **強制**: `app/actions/posts.ts` で所有を確かめる（作成で `authorId` を入れ、更新と削除は所有者でも管理者でもなければ拒む。既存の `sessionExpired` の形の隣に `forbidden` の結果を足す）。管理画面の一覧を著者ごとに絞る。`/admin/users` は管理者だけ。
- **管理画面**: `app/admin/users/page.tsx` と `app/actions/users.ts`（利用者の一覧、役割の昇降、参加方針の切り替え、許可リストの編集。どれもサーバ側で管理者を確かめ直す）。
- **アップロードの掃除**: 著者ごとの所有になったら、本文の走査は規模に合わない。資産の参照テーブル + 参照が 0 になったら削除 + 安全網としての GC に上げる（作者の決定、2026-06-24）。
- **OAuth のライブラリ**（実装時に決める）: 推奨は小さな `arctic`（PKCE / state を扱う）と既存の jose のセッション。代わりに `jose` の `createRemoteJWKSet` と `fetch` で依存なしに書く案もある。作者は依存に慎重なので確かめる（`docs/dev-environment.md` §4）。
- **著者がログインできるようになったら足すテスト**（2026-09-24 合意）: `isAdmin` を false にモックし、`app/actions/tags.ts` の**すべての export を列挙して**呼び（名前の手書きの一覧にしない。検査を忘れた 6 つ目の Action が落ちるように）、それぞれが拒否を返し DB が変わらないことを確かめる。Action は直接 POST できるので、ページの 404 ではなく Action の検査が本当の境界である。E2E ではない（ブラウザは Action を直接呼べない）。管理者専用の Action のモジュール（`app/actions/users.ts` など）も同じ形にする。
- **下流**: `posts.authorId` が入れば、`docs/embed-requirements.md` §24.9 の「自分の記事 / 全記事」のタブを本物の絞り込みで作れる。
