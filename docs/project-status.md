# プロジェクトの状態と先送りの一覧

このブログ（DB を持つ CMS と TipTap のエディタ）の、コードからは読み取れない制約・経緯・運用と、先送りにした作業の記録。機能ごとの設計は `docs/*-requirements.md` と `docs/cms-features.md` にある。2026-09-24 に Claude のプロジェクト memory から移し、今のコードと照合した。

## 1. 概要

- 静的な MDX のサイトを、DB を持つ CMS とブラウザのエディタに作り替えた（2026-06-23、`a259cae`）。ブランチは `main` の 1 本で、作業は PR で入れる（2026-10-12 に統合ブランチの `develop` をやめた。公開と同時に PR・CI・ルールセットで `main` を守るようにしたので、安定版を別に置く役目がなくなった）。
- SQLite（`better-sqlite3` + `drizzle-orm`、`data/blog.db`）。公開ページは `lib/render.ts` の unified のパイプラインで markdown を HTML にし、生の HTML は `rehype-sanitize` で消毒する。
- 認証は JWT の cookie で、14 日のスライディング（`proxy.ts` が再発行、`SESSION_MAX_AGE_SECONDS`）。ログインには回数の制限がある（`lib/login-throttle.ts`）。
- エディタは `/admin/posts/new` と `/admin/posts/[id]/edit` の TipTap（2026-06-29、`b62fef0`）。**保存形式は markdown のまま**で、エディタを替えても `lib/render.ts` と保存の経路は変わらなかった。

## 2. 守る制約

- **`content/posts/*.mdx` を消さない。** `data/` は gitignore されているので、`.mdx` は記事の内容の唯一のバージョン管理された写しで、`scripts/migrate-content.mts` の種でもある。消すと内容が追跡されない DB に取り残され、新しいクローンで種を入れ直せなくなる。
- **スキーマの変更はマイグレーションだけで行う。** 経路は `db:generate` → `db:migrate` だけで、`db:push` は 2026-08-02 に package.json から消した。再び足さない。drizzle-kit 0.31.10 の push は `posts` をその場で変えられず、テーブルを作り直す経路で `CREATE UNIQUE INDEX posts_slug_unique` を 2 回出して途中で止まった。スキーマと DDL が一致していても起きる。`posts` に列を足すときは最後に置く。手順は `npm run db:backup && npm run db:migrate`。
- **マイグレーションの基点は、その時点のスキーマである**（2026-08-02、`b0ac84b`）。過去に手で当てた `ALTER` は `.sql` として残っていないので、歴史を再構成しなかった。`scripts/baseline-db.mts` は台帳を書く前に、ジャーナルをメモリ上の DB に再生して `sqlite_master` を正規化して比べ、食い違えば拒む。drizzle-orm の適用済み判定は `created_at` の比較だけで、ハッシュを見ない。CLI の `drizzle-kit migrate` が同じ判定かは確かめていない。
- DB のパスは `scripts/db-path.mts` が一か所で決める。`BLOG_DB_PATH` を設定したホストで、スクリプトが別の DB に書いて成功と報告するのを防ぐため（`6901b90`）。
- **アップロードは参照で消す。** `data/uploads` のファイル名はバイト列の SHA-256 で、同じ画像は 1 つのファイルを共有する。1 つのファイルが複数の記事を支えうるので、削除は参照の走査で決める。記事を消してもファイルは消えない。掃除は猶予付きの手動のスイープ `npm run gc:uploads`（既定は dry-run、`--delete`、`--grace-hours=N`、既定 24 時間。参照は DB の本文と `.mdx` の和）。誰がどの画像を上げたかの台帳 `uploads` は参照ではなく、掃除はファイルを消すとその行も消す（`docs/abuse-limits-requirements.md` §4・§6）。

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
- **サイトの名前は「Small Diffs」、マークは角丸の四角に「±」**（2026-10-15、オーナーが候補から選んだ）。小さな差分を積み上げる場所、という意味で、技術の記事にも走り書きにも当てはまる。同じ名前のブログ・サービス・GitHub のプロジェクトは検索で見つからなかった（「small diffs」は開発の一般的な言い回しでもあるので、名前での検索では一般の記事に埋もれやすい）。ドメインの空きは確かめていない。マークは白黒だけで、16px のファビコンでも形が残る。幾何は `lib/site-mark.ts` の 1 か所にあり、ヘッダー（`components/SiteMark.tsx`）・ファビコンとアイコン（`scripts/make-icons.mts`）・`public/og.png`（`scripts/make-og-image.mts`）・画像の無い記事の絵（`lib/category-art.ts`、`docs/category-mark-requirements.md`）がそれを描く。Figma の埋め込みが名乗る名前（`lib/embed-provider.ts` の `FIGMA_EMBED_HOST`）は、サイトの名前と切り離してあり変えていない。
- **見送った書式**（新しい理由なしに再提案しない）: 下線、文字色、文字の大きさ、見出しの下線や罫線、Zenn の `:::message` を保存形式にすること。色と大きさは markdown に表現が無く、`rehype-sanitize` が `style` を消すので、公開ページで消える。
- インラインコードのボタンは外した。入力ルール（`` `…` ``）と `Mod-E` で足りる。
- **見た目の約束事は `app/globals.css` の変数に集めてある**（2026-09-30）。書体は IBM Plex Sans JP と IBM Plex Mono（`app/layout.tsx`）、角は大きさで 3 段（記事や一覧の枠・ダイアログ・ポップアップメニューは 8px の `rounded-panel`、ボタン・入力欄・枠の中の箱は 6px の `rounded-box`、バッジやサムネイルなどの小物は 4px の `rounded-chip`。同じ半径でも小さい札は楕円に見えるため。エディタのスラッシュメニューとツールバーのドロップダウンは box。記事本文の部品は各 requirements 文書の値のまま。2026-10-04 に 2px から変更し、6:4 と 8:6:4 を実際の画面で撮って作者が選んだ）、主ボタンは墨の塗りの `.button-primary`。色は作者のパーソナルカラー（紫・オレンジ・緑）から作った: ライトの地は薄い紫（`#f3eef8`）、タグの札は一段濃い紫（`.tag-chip`）、カテゴリ名の前の点は技術記事がオレンジ・ブログが緑（`.category-mark`）、見出し・強調・目次の選択中の項目は赤紫寄りのえんじ（`--accent`、明 `#9f1239` / 暗 `#ec7a92`）。記事の枠・目次・エディタの本文・入力欄は白い `--surface` を敷く。ダークの地は `#0a0a0a` のまま（紫に寄せても見分けがつかなかった）。それまでは Geist と OS 任せの日本語、GitHub Primer の赤、黒い角丸ボタンという既製品の組み合わせに見え、日本語の書体は 1 つも指定していなかった。書体・地・札・アクセントの候補はそれぞれ実際の画面で撮って比べ、作者が選んだ。次の 4 つは採らない。アクセントの藍（強調がリンクの青と見分けにくい、`docs/link-requirements.md` §7.1）。アクセントを警告の囲み枠と同じ色にすること（見直しの出発点が、大事な箇所と危険な箇所の赤が同じだったことである。警告は赤 `#cf222e` のまま）。オレンジや緑を本文や札に使うこと（注意の琥珀や「保存済み」の緑と意味が紛れる）。主ボタンをアクセントの色にすること（削除の赤と紛れる）。地が白でなくなったので、地の上に直接置く補足の灰色の文字は `zinc-500`（紫の地で 4.23:1）ではなく `zinc-600`（6.77:1）にしている。白い面の上のダイアログや吹き出しは `zinc-500` のままでよい。
- **画面の部品と文言は、既にある型に合わせる。** 新しい画面ごとに形を作ると、同じ操作が画面によって違って見えるため。型ごとの正は、それを決めた節にある。
  - 開閉するメニューは `docs/site-header-requirements.md` §4、設定のフォーム（1 行の欄、補足、文字数、「保存」、欄ごとの理由）は `docs/site-settings-requirements.md` §5 と `docs/multi-author-requirements.md` §6.1。
  - 確認の「やめる」と操作のボタンは、ページの囲みの中では枠付きにし（「やめる」は控えめな枠、取り返せない操作は赤い枠）、開閉するメニューの中では文字だけにする。メニューの中では文字だけでも行に見えるが、囲みの中では枠が無いとボタンに見えない（2026-10-19、オーナー）。クラスは `app/admin/(list)/panel-confirm.ts`。
  - メニューの中で権限によって出し分ける項目は、1 つのグループにまとめて最後に置き、区切る。権限の無い人には、区切りより上と同じ形のメニューが出る（`docs/multi-author-requirements.md` §11）。
  - ボタンが言っていることを、開いた先の見出しで繰り返さない（`docs/site-header-requirements.md` §3.3）。
  - 欄の補足は、値がどこに出るか・空のときどうなるか・変えても変わらないものだけを書く。
  - 権限の無い操作は理由を返し、権限の無い画面は 404 にして行の有無を明かさない（`docs/multi-author-requirements.md` §4.2）。
  - 幅 360px で 1 行に収まるかを先に確かめる。上限が収まりで決まる値は、そこで測って決める（`docs/multi-author-requirements.md` §3 の表示名）。
  - 日本語の中の英字の語は前後に半角の空白を置く（「この URL は」）。2026-09-03 にオーナーが暫定で決めた。実際に書かれた記事が別の書き方に落ち着いたら見直す。この書き方の根拠に既存の UI の文言やサンプルの記事を挙げない。どちらも Claude が書いたものである。

## 4. 公開ページ

- **目次は最後に集める。** `rehype-sanitize` の `clobberPrefix: 'user-content-'` がすべての id を書き換えるので、`lib/rehype-collect-toc.ts` は消毒の後で id を読む。`lib/rehype-clobber-fragment-links.ts` はフラグメントの href に同じ書き換えを無条件にかける。
- `useActiveHeadingId` は `IntersectionObserver` ではなく、rAF で間引いたスクロールのリスナーである。IO は「交差しない → 交差しない」の移動を何も報告しないので、帯を一気に飛び越すと強調が古いまま残った。毎回 `getBoundingClientRect().top` から導き直し、覚えない。
- `--breakpoint-toc` と `toc:` の変種は、グリッド・モバイルで隠す・デスクトップで出すの 3 か所の唯一の源である。1 か所だけ動かすと、目次が二重になるか、どこにも出なくなる。サイトの箱 `--container-page` は本文と目次を合わせた幅で、境目では切り替えない（`docs/toc-requirements.md` §6.1）。レイアウトは `docs/editor-pitfalls.md` §17.2 のグリッドで、`position: fixed` のレールは作者が退けた。
- `html` に `scrollbar-gutter: stable` を付けている。付けないと、スクロールバーの要る長いページは幅が狭くなり、中央寄せのレイアウト全体が動く。スクロールを止めるモーダル（エディタのドロワーやダイアログ、画像の拡大）を開いたときも、スクロールバーが消えた分だけ画面が横にずれる。代わりに、スクロールの要らない短いページでは確保した幅が空白として残り、ヘッダの下線がその手前（約 15px）で途切れるのを受け入れる。2026-09-29 に一度外したが、モーダルを開くだけでずれるようになったので 2026-09-30 に戻した。
- 本文の幅は `max-w-3xl` のままにし、`#post-body` に背景と枠を付けた（参考サイトは 760〜781px で、この サイトは 768px だった）。
- **OGP**: Next はページが `openGraph` を設定するとレイアウトのものを丸ごと置き換える（マージしない）ので、どのページも `app/shared-metadata.ts` の `sharedOpenGraph(site)` を展開する（`site` は管理者が設定した名前と説明文、`lib/site-settings.ts`）。`og:title` は `title` に従わない。サイト全体で 1 枚の `public/og.png` を `scripts/make-og-image.mts` が本物の Chrome で撮って commit している。記事ごとの `ImageResponse` は、CJK のフォントを渡す必要があり（手元の唯一のフォントは 9.6MB で、サブセット化の道具が無い）見送った。Slack のプレビューは robots.txt を守らない（X と Facebook のデバッガは守る）。

## 5. 運用（Tailscale Funnel、2026-08-02 から公開中）

- 公開 URL（Funnel の `*.ts.net` の名前）は `.env` の `SITE_ORIGIN` にだけ置き、リポジトリには書かない（2026-10-12、公開リポジトリで所有者とホストを結び付けないため）。今は Funnel、後で Cloudflare Tunnel + ドメインに移る（Tunnel は無料だがドメインの購入が要る）。
- アプリは WSL2（NAT）で動く。Tailscale を Windows 側に入れると、Funnel はアプリに届かなかった（502）。WSL の中に Tailscale を入れ、`tailscale up --hostname=blog --operator=$USER` で同じネットワーク名前空間に置く。`tailscale funnel 3001` は前景で動き、端末を閉じると消える。常時は `tailscale funnel --bg 3001`。
- tailnet の機器は WSL の `blog` だけで、作者の Windows は入っていない（2026-10-18 に確認）。そのため、作者のブラウザで Funnel の名前が開ければ、tailnet の外から公開できている。`tailscale serve` の tailnet だけの名前は、作者のブラウザからは開けない。
- 本番ビルド（`npm run build` + `npm start`）で動かす。`.env` に `SITE_ORIGIN` と `SESSION_COOKIE_SECURE=true` が要る。`SESSION_COOKIE_SECURE` はホストではなく経路に従う（平の HTTP で試すなら `false` にしないとログインが黙って失敗する）。`.env` は Claude からは読めない。
- **noindex は有効**（`65cf13c`）。`SITE_INDEXABLE` は明示的に入れる設定で、robots.txt は `Disallow: /`。恒久のドメインに移ったときだけ外す。
- Cloudflare に移るときにすること: `/admin` の前に Cloudflare Access（Google を IdP にでき、リダイレクト先が `<team>.cloudflareaccess.com` なのでサイトのホスト名が変わっても動かない）。リバースプロキシが別のホスト名で前に立つと、Server Actions のオリジン検査が POST を拒むことがあるので、`node_modules/next/dist/docs/` で許可するオリジンの設定を確かめる。
- CSP の `frame-src` は、Cloudflare に移るとき（埋め込みのラッパー方式と一緒）に決める（2026-08-31、作者の決定）。今は生の `<iframe>` を `rehype-sanitize` が消すので、ページ上の iframe は `rehypeEmbed` が消毒の後で組んだものだけで、`frame-src` が守るのは解決段の将来のバグである。罠が 2 つある。① 許可リストをプロバイダの `hosts` から作らない（ページのホストで、`src` のホストではない。導出元は `lib/embed-provider.ts` の `src`）。② gist は `srcdoc` で、親の CSP を継承する。後から `script-src` を足すと gist が壊れる（`docs/embed-requirements.md` §18）。

## 6. 先送りの一覧

- **アップロードの掃除の定期実行**: WSL2 の systemd user timer で設定済み。置き場所と入れ方は `docs/dev-environment.md` §6（`deploy/systemd/`）。Cloud Run などへ移るときは再検討する（systemd の timer は使えず、Cloud Scheduler + Cloud Run Job 等になり、`data/uploads` の置き場所も再設計になる）。
- **「変更を破棄」と、より豊かな「下書き保存」**: 作者が先送りにした。
- **サイトのヘッダーに入口を足すとき**（2026-10-15）: ヘッダーはブランド（マークと「Small Diffs」）・「記事 ▾」・「走り書き」と、ログイン中だけの「投稿する」とアカウントのボタンを、幅 360px で 1 行に並べる（`docs/site-header-requirements.md` §3）。ログインしていないときの右側は、参加の入口のために空けてある（同 §6）。公開側のリンクをさらに足すなら、「記事」のメニューに入れるか、360px で 1 行に収まることを先に確かめる。
- **記事一覧の人気順の並べ替え**（2026-10-18）: 並べる数が無いので作らない。見直す条件と足し方は `docs/home-requirements.md` §6。
- **連載**（2026-10-18）: 始める予定が決まってから作る。タグでもカテゴリでも足りない。タグのページは新しい順に並び、前後の回への移動も「第 N 回」の表示も無い。カテゴリは 1 記事に 1 つなので、技術記事の連載が技術記事の一覧から抜ける。作るときの最小の形は、連載の表（名前・説明・slug）と記事の所属、記事のページの「連載『…』第 N 回」と前後のリンクと目次、`/series/<slug>` の一覧、記事の設定の選ぶ欄。順番は公開日の古い順にして、並べ替えの画面は作らない。目次の位置や番外編の扱いは、1 本目を書いてから決める。
- **「誰でも」に切り替える前の荒らし対策**（2026-10-19）: 公開される中身の承認か本数の上限、通報の窓口と利用規約、タグの追加とリンクの取得の回数の上限、参加の数の上限。重さの順と理由は `docs/abuse-limits-requirements.md` §9.1。
- **記事の検索**: `docs/search-requirements.md` で設計した（2026-10-15）。公開中の行をメモリの上で絞り込み、FTS5 も `LIKE` も使わない（同 §3.1）。ヘッダーの入力欄、ページ分け、索引は同 §7 に先送り。
- **コード化の右クリックメニュー**（2026-07-01）: 入力済みの選択にインラインコードを当てる手段。空の選択の右クリックはブラウザ既定のメニューに通す。TipTap にはコンテキストメニューの部品が無いので、`editor.view.dom` の `contextmenu` と `toggleCode()` で作る。`Mod-E` が既にキーボードの利用者を覆っている。
- **記事の設定に現在の説明文を出す**（2026-09-30）: TL;DR の文か本文からの自動抜粋か、その出所と 120 字で切れたかを設定ドロワーで見せる案。公開後に記事一覧のカードで確かめられるとして見送った。一覧のカードは 2026-10-18 から説明文を出さないので、確かめる場所は内部リンクカード・SNS の共有カード・ピックアップの枠に減った（`docs/home-requirements.md` §2）。残るのは、公開前に説明文を確かめられないことと、TL;DR が切れたことに書いている間は気付けないこと（`docs/summary-requirements.md` §4・§3.4）。
- **本文画像の配信の最適化**（2026-09-30）: WebP への変換、幅違いの複数版と `srcset`、原本の保持。保存形式（`![alt](src)`）に `srcset` や寸法を書く場所が無いので、描画・エディタ・`gc:uploads`・既存画像の移行にまで波及する。記事あたり画像 1 枚程度の今は見合わないとして、作者が最小構成（§3）を選んだ。転送量や表示速度が実際に問題になったら見直す。
- **`data/blog.db.bak-20260625-152304`**: 出所の分からない `cp` 形式のファイルで、WAL のもとでは古いスナップショットでありうる（`docs/dev-environment.md` §3）。バックアップとして扱わない。

## 7. 複数の著者（設計済み、一部だけ実装）

OAuth なしで作れる第 1 段（所有の強制、停止、表示名と署名）と、OAuth の段（Google でのログイン、参加方針と招待、利用者の画面）の設計は `docs/multi-author-requirements.md` にある（2026-10-17、2026-10-18）。この節は全体の方針と、その文書に入っていない部分の骨組みを持つ。

2026-06-24 に作者と設計を確かめ、実装は先送りにした。描画は既に XSS に対して安全（`rehype-sanitize`）で、残るのは認証と所有である。

### 7.1 決めたこと

- 著者は Google でログインする（OAuth2 / OIDC）。管理者はユーザー名とパスワードのまま（管理者が締め出されないため。Google の OAuth のリダイレクト URI は localhost 以外 HTTPS が必須で、平の LAN / HTTP では使えない）。
- 役割は `admin` と `author`。記事の編集と削除はその著者か管理者。管理者はすべての記事・利用者・参加方針を扱う。
- 著者になれる条件は実行時に切り替えられる: `open`（どの Google アカウントでも）と `allowlist`（許可したメールだけ）。
- 閲覧は公開のまま（下書きは公開側で 404 のまま）。
- 利用者のモデル（2026-09-24 に確認）: 読者は読むだけ、著者は自分の記事を書く、管理者は他人の記事の削除と著者の BAN もできる。停止（BAN）は `docs/multi-author-requirements.md` §5 で設計した: 停止の時刻の列をセッションの読み込みとログインで確かめ、公開側の読み込みからその著者の行を外す。行は消さない。参加方針が `open` のとき、走り書き（`docs/scribble-requirements.md` §9）はログインした直後に公開できるので、BAN と、管理者が他人の行を非公開にする操作がその前提になる。
- 公開側に出す著者の名前は、`users.display_name` に本人が決める（`docs/multi-author-requirements.md` §6）。`username` はログイン用のまま公開側に出さない。OAuth の段では、Google の `name` を表示名の初期値にする。
- 費用は 0 の見込み（`openid` / `email` / `profile` だけなら請求アカウントも審査も要らない）。Google Cloud の OAuth クライアントの作成と `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` の設定は作者が行う。リダイレクト URI は `SITE_ORIGIN` から作る（`docs/multi-author-requirements.md` §9.8）。

### 7.2 実装済みのもの（2026-09-24）

`users.role`（`admin` / `author`、既定は author。`drizzle/0012_user_role.sql` が既存の行を admin にする）と、`lib/dal.ts` の `isAdmin` / `verifyAdmin`。役割は検査のたびに DB から読み、JWT には入れない（下の設計の「`SessionPayload` に role を足す」はこれで置き換わった）。最初の利用者は `/admin/tags` の管理者限定（`docs/editor-requirements.md` §12.33.1）。

`posts.authorId`（2026-10-15、`docs/library-requirements.md` §3.1）。作成のたびにセッションの利用者を入れ、`drizzle/0015_library.sql` が既存の行を最も id の小さい管理者で埋める。ライブラリのいいねと閲覧の記録、第 1 段の所有の強制と管理画面の一覧の絞り込みが読む。

第 1 段（2026-10-17、`docs/multi-author-requirements.md`）: 所有の強制（`lib/post-access.ts`）、停止（`users.suspended_at`、`lib/dal.ts` と公開側の読み込み）、表示名と署名（`users.display_name`、`/admin/account`）。§7.3 の「著者がログインできるようになったら足すテスト」のうち `app/actions/posts.ts`・`app/actions/revisions.ts`・`app/actions/tags.ts`・`app/actions/settings.ts` の分は、ここで済んでいる。

OAuth の段（2026-10-18、`docs/multi-author-requirements.md` §9）: `drizzle/0018_author_google.sql`（`users.google_sub`、`username` と `password_hash` の null、`author_allowlist`）、`lib/google-oidc.ts`・`lib/google-login.ts`・`lib/author-access.ts`、`/auth/google` とそのコールバック。セッションは `userId` だけを持ち、名前は `lib/account-name.ts` が `users` から作る。利用者の画面は `/admin/users`（`lib/admin-users.ts`、`app/actions/users.ts`）。

利用者の見分け（2026-10-18、`docs/multi-author-requirements.md` §10）: `drizzle/0019_author_identity.sql`（`users.joined_via`・`email_hash`・`created_at`、`display_name_history`）、メールの鍵付きハッシュ（`lib/email-hash.ts`）、表示名の決まり（`lib/display-name.ts` の `saveDisplayName`）。

### 7.3 設計の骨組み（作るとき）

- **スキーマ、OAuth の流れ、利用者の画面**: `docs/multi-author-requirements.md` §9.2・§9.3・§9.5。`posts.authorId` と `app_settings` は既にある（§7.2）。所有の強制は第 1 段で済んでいる（同 §4）。
- **アカウントメニュー**: `docs/site-header-requirements.md` §3.3 で設計した（2026-10-15）。ログアウトと「新規作成」は管理画面からヘッダーへ移る（同 §5）。公開ページのヘッダーがセッションを読むので、公開ページをキャッシュするときはこの部分を分けて考える。
- **アップロードの掃除**: 走査のまま（§2「アップロードは参照で消す」）。資産の参照テーブル + 参照が 0 になったら削除 + 安全網としての GC に上げるのは、夜ごとの `gc:uploads` の走査が数秒を超えるようになってからにする。参照は本文・`draft_content`・`post_revisions`・`app_settings` に散らばり、表の増減を書き込みの経路ごとに数えると、1 か所の漏れで使っている画像を消す。走査はその漏れが起きない。エディタの手元のバッファにだけ貼られた画像はサーバーから見えないので、表にしても猶予付きの GC は残り、得るのは走査の速さだけである。2026-06-24 の決定は条件を「著者ごとの所有になったら」としていたが、所有が入った後も記事 4 本・ファイル 4 個で走査は一瞬だったので、条件を規模に改めた（2026-10-19）。
- **編集の手元のバッファ**（2026-10-17）: 控えは `localStorage` に平文で残り、ログアウトしても消えない（`docs/draft-buffer-requirements.md` §4）。共用の端末で書く著者が出てきたら、明示的なログアウトで自分の控えを消し（控えが残っていればログアウトの前に知らせる）、期限（今は 30 日）を短くする。セッションが切れたときはログインし直すだけでログアウトを通らないので、守りたい控えは消えない。暗号化はしない。鍵をブラウザに置けば同じ端末の人が暗号文と鍵の両方を読め、守りにならない。効くのは利用者ごとの鍵をログインの後にだけサーバーから渡す形だが、手間はこの機能と同じくらいかかり、同じ端末には履歴や管理画面のキャッシュも残るので、守れる範囲は狭い。未発表の情報のような、人に見せられない下書きを書く使い方が出てきたときに検討する。
- **著者がログインできるようになったら足すテスト**（2026-09-24 合意）: `isAdmin` を false にモックし、`app/actions/tags.ts` の**すべての export を列挙して**呼び（名前の手書きの一覧にしない。検査を忘れた 6 つ目の Action が落ちるように）、それぞれが拒否を返し DB が変わらないことを確かめる。Action は直接 POST できるので、ページの 404 ではなく Action の検査が本当の境界である。E2E ではない（ブラウザは Action を直接呼べない）。管理者専用の Action のモジュール（`app/actions/users.ts` など）も同じ形にする。
