編集メモ: `docs/*-requirements.md` は本来1機能1ファイルの慣習だが、2026-09-06 の設計相談で3機能をまとめて記録したいというユーザー指示により、このファイルに3機能ぶんの記録を束ねてある。節番号は機能ごとに独立して1から振っている。3機能は2026-09-06の相談で合意された、2026-09-07 着手予定の同時進行タスク。

---

# 読了時間推定（見送り）

状態: **見送り** — 2026-09-06 に設計まで進めたのち、実装しないことを決定
作成: 2026-09-06、着手前に書いている（`docs/link-card-requirements.md`・`docs/embed-requirements.md` と同じ流儀）
関連: `docs/footnote-requirements.md`（脚注マーカーの除外/包含判定を流用）、`docs/link-card-requirements.md` §4.2・`docs/embed-requirements.md`（`<div class="link-card">`/`<div class="embed">` が可視テキストを持たない、という前提を共有）

本書は実装より前に書いた設計の記録で、途中で見送りに転じた。以下は見送りに至った経緯（§9）と、見送り前に固めていた設計（§1〜§8、参考として残す）。「実測」と明記していない数値・判断はすべて未検証の見積もりである。

---

## 1. 目的とスコープ

dev.to でよく見る「約n分」（"X min read"）表示——オープンソースで実装が公開されており実在が確認できる——に倣う計画だった。

Zenn は少なくとも2020-09-30時点で「想定読了時間」を記事のメタ情報の一つとして持っていたことが確認できる（`zenn-dev/zenn-community` issue #98 本文、「今のところ記事のメタ情報としては『Like数』『最終更新日』『文字数』『想定読了時間』『カテゴリ』のみとなっています」、添付スクリーンショット付き）。一方 2026-09-06 に現在の記事ページを直接フェッチした限りでは見当たらなかった——いつ・なぜ外れたかは確認できていないが、現在のメタ情報からは消えている。Qiita については当時・現在とも同等の表示を示す一次情報が見つかっていない。

滞留時間の正確な予測ではなく、記事の分量感を読者に伝えるための粗い目安でよい、という前提だった。表示対象は次の3箇所（§4）を想定。編集中の下書きプレビュー（`draftContent`）は初期実装のスコープ外とする想定だった（§7）。

## 2. 対象コンテンツと除外範囲

**数える**: 通常の地の文——段落、見出し、リスト項目、引用、テーブルセル、脚注定義の本文。

**数えない**: フェンス付きコードブロック（` ``` ` / `~~~`）の中身、`<div class="link-card">`/`<div class="embed">` の行（可視テキストを持たない参照専用ノード）、脚注参照マーカー `[^label]` そのもの（定義側の本文は数える）。

Markdown 記法そのもの（見出しの `#`、強調の `*`、リンクの `[text](url)` の `url` 部分など）を厳密に取り除く精密カウントは初期実装では見送る（§7）——記法文字の分量は本文全体からみて誤差程度で、「約n分」という粒度の表示に対して割に合わない。

## 3. 算出アルゴリズム

### 3.1 パース方式: AST 走査ではなく行スキャン

**決定**: remark/unified の AST を組んで走査するのではなく、`lib/footnotes.ts` の `incompleteFootnotes`（`lib/footnotes.ts:30`）と同じ「行ベースの正規表現スキャン」で実装する。新規モジュール `lib/reading-time.ts` に `estimateReadingTime(body: string): number` を1つだけ置く（`lib/slug.ts` と同じ、小さく単機能な `lib/*.ts` の流儀）。

**理由**: ホーム・タグ・カテゴリの一覧画面は記事ごとに `renderMdxToHtml`（`lib/render.ts`）を呼んでいない。一覧の読了時間表示のためだけに、記事1件ごとに remark→rehype のフル変換を余分に走らせるのは重い。「詳細ページだけ既存 AST を再利用し、一覧はスキャンで済ます」という案も検討したが、それだと同じ記事で一覧の値（スキャン）と詳細の値（AST）が食い違いうる——同じ記事はどの画面でも同じ「約n分」を出すべきなので（§6）、全画面で共通の軽量関数に統一する。

`lib/footnotes.ts:11-13` がまったく同じ判断をすでに一度書いている:「Deliberately a scan rather than a parse. Pulling markdown-it in here would mean the editor's parser... loading in a server action to answer a yes/no question about two line shapes.」——読了時間もこれと同じ形の問い（この行は地の文か否か）である。

一覧クエリ側の懸念（`body` 列を追加取得する必要があるか）は解消済み: `getAllPosts`/`listAllPosts`/`getPostBySlug`（`lib/posts.ts:32-51`）はいずれも `db.select()`（列指定なし）で全列を取得しており、`toPost`（`lib/posts.ts:17-30`）が `body: row.body` をそのまま `Post` に渡している。一覧側にクエリ変更は不要——`PostCard` はすでに完全な本文を手にしている。

### 3.2 除外ルールの実装

- フェンス判定は `lib/footnotes.ts:18` の `FENCE`（`` /^ {0,3}(`{3,}|~{3,})/` ``）と同じ形で、フェンス内の行を読み飛ばす。
- `^<div class="(link-card|embed)"[^>]*></div>$` に一致する行は1行まるごと除外する。この形は実装が実際に吐く形そのもの——`components/editor/link-card-extension.ts:59` と `components/editor/embed-extension.ts:59` がそれぞれ `` `<div class="link-card" data-href="${escapeHref(href)}"></div>` `` / `` `<div class="embed" data-href="${escapeHref(href)}"></div>` `` を `state.write` している。
- 脚注参照 `[^label]`（`lib/footnotes.ts:26` の `REFERENCE`）はマッチした部分を文字列から取り除く。定義行 `[^label]: text`（`lib/footnotes.ts:22` の `DEFINITION`）はラベル部分だけ剥がし、本文（`text`）は残す。
- 改行は `/\r?\n/` で分割する。`\n` 単独ではないのは `lib/footnotes.ts:35-41` と同じ理由——フォーム送信が値の改行を CRLF に書き換える（[[form-submission-crlf-body]]）ため、`\r` が行末に残ったままだと後段の正規表現が丸ごと外れる。

### 3.3 文字数/単語数から分への換算

**決定**: 除外処理を終えた文字列から、まず CJK文字（ひらがな U+3040–309F、カタカナ U+30A0–30FF、CJK統合漢字 U+4E00–9FFF、全角句読点等 U+3000–303F・U+FF01–FF60、繰り返し記号「々」「ー」）をすべて取り除きながら1文字ずつ数える。取り除いた残り（半角英数字・記号・その他）を空白/CJK境界で分割し、空でないトークンを「単語」として数える。

分 = `Math.ceil(CJK文字数 / 500 + 単語数 / 200)`、最小 1分（0分・空文字列でも「約1分」を下限にする）。

**日本語文にはスペースがないため、生の文字列を先に空白分割してから振り分ける実装は誤り**——スペース区切りの単語カウントを地の文全体にかけると、句読点のない日本語の段落1つが「1単語」として扱われ、読了時間が実質ゼロ扱いになる。必ず「CJK文字を1文字ずつ抜き出して残りだけをトークン化する」の順で実装する。

**未検証**: 500字/分（CJK）・200語/分（非CJK）はどちらも実測ではなく、一般的な黙読速度の目安値。実装しなかったため較正の機会もなかった。

画像・埋め込み1件あたりに固定秒数を加算する方式（dev.to 等で知られる）は初期実装では見送る想定だった（§7）。

## 4. 表示場所（想定）

| 画面                         | ファイル                    | 挿入位置                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------- |
| ホーム/タグ/カテゴリの一覧行 | `components/PostCard.tsx`   | `<time dateTime={post.date}>{formatPostDate(post.date)}</time>` と category リンクを並べている `flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500` 行（`components/PostCard.tsx:30`）に、同じスタイルの inline 項目として追加 |
| 記事詳細ページのヘッダー     | `app/posts/[slug]/page.tsx` | 上と同じ構造を持つヘッダー内の行（`<time dateTime={post.date}>{formatPostDate(post.date)}</time>` — `app/posts/[slug]/page.tsx:153`）に追加                                                                                                   |
| 管理画面の記事一覧           | `app/admin/page.tsx`        | `{post.slug} · {formatPostDateTime(post.date)                                                                                                                                                                                                 |     | '未公開'} · {post.category}` の行（`app/admin/page.tsx:43`）に `·` 区切りで追加 |

いずれも `estimateReadingTime(post.body)` を直接呼ぶ想定だった（§3.1 の通り、`body` はどの画面でもすでに手元にある）。

## 5. 計算タイミングと永続化しない理由

**決定**: DB に列を追加せず、`body` から都度計算する純粋関数として実装する。

**理由**: 保存する場合、本文を更新するたびに読了時間を再計算して書き戻す同期コードが要る。しかもそれは `draftContent` で実際に踏んだ不具合のクラス——「後から足したフィールドが古い行では読めない」（[[draft-content-json-column-stale-fields]]、`lib/posts.ts:53-65` の `toDraftContent` 正規化がまさにその埋め合わせ）——をもうひとつ増やすだけになる。読了時間は本文だけから決まる純粋な値で、行スキャン自体が軽いので、都度計算のコストは無視できる。

## 6. 受け入れ基準（未実装のまま凍結）

| 基準                                                             | 状態               |
| ---------------------------------------------------------------- | ------------------ |
| フェンス付きコードブロックの中身は数えない                       | 見送りにより未実装 |
| `<div class="link-card">` / `<div class="embed">` の行は数えない | 見送りにより未実装 |
| 脚注参照マーカー `[^label]` は数えないが、定義文の本文は数える   | 見送りにより未実装 |
| 0分にはならず、最小で「約1分」を返す（空本文含む）               | 見送りにより未実装 |
| 同じ記事なら一覧・詳細・管理画面で常に同じ分数が出る             | 見送りにより未実装 |

## 7. 見送った拡張（参考）

- 画像・埋め込み1件ごとの固定加算秒（dev.to 等の方式）。
- Markdown 記法文字（`#`、`*`、リンクの `url` 部分）を厳密に除去する精密カウント。
- 速度定数（500字/分・200語/分）を実測記事で較正する。
- 下書きプレビュー（`draftContent`）での読了時間表示。

## 8. 表示バリエーションとして検討した代替案

参考にしたサイトは「約n分」という具体的な数字ではなく、**バッジ**（ブロンズ/シルバー/ゴールド/ダイヤ）で分量感を示す方式を採っていた。条件は画像枚数と文字数の AND（例: ブロンズ = 画像5枚以上 かつ 文字数1,000文字以上）。個人差のある「分」という単位で断定しない点は読了時間の弱点（§9）への有効な回避策だった。

このブログへの転用は2点で不適合と判断した:

1. **画像軸が機能しない**——`components/PostCard.tsx` のコメントの通り「ほとんどの記事に画像がない」技術ブログなので、画像枚数をしきい値に混ぜると大半の記事が最低ランク固定になる。
2. **段位（クラウン/メダル）の含意が合わない**——ブロンズ→ダイヤの序列は「作り込むほど上位」という達成感の演出で、写真つきレビュー記事には合うが、技術記事では「簡潔に書けた記事」を格下に見せる変な評価軸になる。

バッジ自体の設計思想（数字で断定しない）は正しいが、この2点の不適合と§9の理由により、バッジ化してまで実装する動機は残らないと判断した。

## 9. 見送りの経緯（2026-09-06）

1. 当初の前提だった「Zenn/Qiita/dev.to 系ブログの定番機能」という根拠が、調査の結果ほとんど崩れた。実在を確認できたのは dev.to のみで、Zenn は2020年時点であった痕跡（§1、issue #98）はあるが現在は見当たらず、Qiita は痕跡すら見つからなかった。
2. 技術ブログはコードブロックと地の文が混在するため、読了時間の見積もりが特に不正確になりやすいジャンルである。個人差の問題（§8で検討したバッジ代替案の動機）が他ジャンルより大きく出る。
3. §8のバッジ代替案も、このブログの記事の性質（画像が少ない、序列付けが評価軸として不適切）に合わないと判断した。
4. 実装コスト自体は低い（DB変更もサードパーティ依存も不要な純粋関数）が、得られる価値がRSS/Atomフィード・非公開限定URL投稿（本ファイル後述）ほど明確ではない。

以上により、実装せず見送ることとした。`docs/reading-time-requirements.md` というファイル名では新規に立てず、本ファイルに統合した。

---

# RSS/Atom フィード

状態: **実装済み**（2026-09-06。`lib/rss.ts`、`app/rss.xml/route.ts`、`app/layout.tsx`）
作成: 2026-09-06、着手前に書いている
実装: `lib/rss.ts`（`buildRssFeed`/`wrapCdata`）、`app/rss.xml/route.ts`、`app/layout.tsx`（`alternates.types`）、`lib/rss.test.ts`
関連: 本ファイル内「非公開限定URL投稿」§7（フィードのクエリはその機能を自動的に取り込む設計にしてある）

## 1. 目的とスコープ

まだ存在しない RSS/Atom 配信を作る。既存の `getAllPosts()` をそのまま再利用できる、という当初の想定を調査で確認済み——追加クエリなしで組み立てられる（§3）。

**決定**: フォーマットは RSS 2.0 のみとし、Atom は作らない。

**理由**: このリポジトリの Next.js 16.2.12（`node_modules/next/package.json` で確認）の公式ドキュメント（`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`、"Non-UI Responses" 節）が挙げる具体例が `app/rss.xml/route.ts` であり、RSS 2.0 は主要フィードリーダーへの互換性が最も広い。RSS と Atom を並行整備するのは、得られる利便性に対してシリアライズを二重に保守するコストが見合わない（Atom を後から追加したくなった場合も §5 で組み立てるアイテム配列を共有できるので、コストは限定的）。

## 2. 実装方式: Route Handler、専用ファイル規約はない

このバージョンの Next.js には `sitemap.ts`/`robots.ts` のような専用ファイル規約が RSS/Atom には存在しない。`route.md` の該当節はこう書いている:

> "You can use Route Handlers to return non-UI content. Note that `sitemap.xml`, `robots.txt`, `app icons`, and open graph images all have built-in support."

続く例が `app/rss.xml/route.ts`——`GET` を export し、`new Response(xmlString, { headers: { 'Content-Type': 'text/xml' } })` を返す形。したがって `app/rss.xml/route.ts` を新規作成し、素の Route Handler として実装する。

**注意**（advisorレビューで指摘）: `route.md` が挙げる例の `GET` は引数なしだが、§7で決めた `?all=1` を読むにはリクエストが要る——実際の signature は `export async function GET(request: Request)` とし、`new URL(request.url).searchParams.get('all')` でクエリを読む。引数なしの `GET()` のままでは `?all=1` は実装できない。

`app/sitemap.ts` は存在しない（確認済み）。`app/robots.ts` は存在するが、`siteIndexable`（`lib/site.ts:43`）による許可/拒否ポリシーを返すだけの静的な実装で、投稿を1件もクエリしていない——「全投稿を機械可読に列挙する」既存の前例としては使えず、フィード用のクエリはこの機能で新規に書く。

## 3. データソースとサイトメタ情報

- 投稿一覧: `getAllPosts()`（`lib/posts.ts:34-42`）をそのまま使う。すでに `draft=false` かつ `unlisted=false` でフィルタ済み（非公開限定URL投稿 §4 で追加）、`date` 降順。`Post` 型（`lib/types.ts:1-31`）に `title`・`slug`・`date`・`description`・`category`・`tags`・`body` に加えて `unlisted`・`updatedAt`（いずれも2026-09-06追加）も載っているが、このフィードが使うのは前者のみ——`unlisted` は `getAllPosts` のフィルタで既に処理済み、`updatedAt` は§4の決定によりフィードに出さない。追加クエリは不要。
- サイト起点 URL: `siteOrigin`（`lib/site.ts:33`、`SITE_ORIGIN` 環境変数、既定 `http://localhost:3001`）。`app/layout.tsx:28` の `metadataBase: siteOrigin` と同じ値を使う。
- サイト名/概要: `SITE_NAME = 'Tech Blog'`・`SITE_DESCRIPTION = '個人技術ブログ'`（`app/shared-metadata.ts:6-7`）。

## 4. 各アイテムの内容

**注意**（2026-09-06、advisorレビューで指摘）: 以下の2つは静かにXMLを壊す/読者向けの主要フィールドを汚す経路なので、実装時に必ず塞ぐこと。

- `post.slug` は `string | null` 型（`lib/types.ts:29`、「in practice always set」というコメント付き）。`` `${siteOrigin}/posts/${post.slug}` `` のようにそのまま埋め込むと、万一 `null` の行があった場合 `/posts/null` という URL が `<link>`/`<guid>` にそのまま出力されてしまう——TypeScript はテンプレートリテラルへの `null` 埋め込みを型エラーにしない。**フィード組み立て時に `post.slug !== null` でフィルタする**（`getAllPosts()` が返す行は公開済みで実質必ず slug を持つはずだが、型がそう主張していない以上、実装側で明示的に弾く）。
- `post.date` が `''`（未公開の sentinel）だと `new Date('').toUTCString()` は例外を投げず、文字列 `"Invalid Date"` を返す——これがそのまま `<pubDate>` に出ると多くのフィードバリデータで検証エラーになる。`getAllPosts()` は `draft=false` のみ返すので理論上 `date` は必ず設定済みだが、同じ理由（型が保証していない）で `date !== ''` をアイテム構築時にもう一度確認する。

- `<title>`: `post.title`
- `<link>` / `<guid isPermaLink="true">`: `${siteOrigin}/posts/${post.slug}`（上記の null チェック後）
- `<pubDate>`: `new Date(post.date).toUTCString()`。Zenn実測のフィードで確認した実際の出力形（`Mon, 03 Aug 2026 09:18:05 GMT`）と一致する——「RFC 822 形式に変換」を自前でフォーマットする必要はなく、`toUTCString()` 一発でよい。`post.updatedAt`（2026-09-06に追加、公開ページの「更新: …」表示の元になった列——本ファイルとは別に `post-date-and-time-display` の記録を参照）は載せない。Zenn自身のフィード（`zenn.dev/zenn/feed` 実測）も、サイト側では更新日を出しているのにフィードには入れていない——ページの表示とフィードの項目は必ずしも一致させなくてよい前例。
- `<title>` / `<description>`: どちらも CDATA で包む（Zenn実測でも両方CDATA——`title`にも `&`/`<`/`>` が普通に入りうる技術ブログなので、`escapeXml` の個別エスケープより一律CDATAのほうが手書きミスの余地が小さい）。`<link>`/`<guid>` はスラッグが16進文字列で `&`等を含みえないため素の文字列でよい。
- **注意**: CDATAで包む文字列自体に `]]>` が含まれると、そこでCDATAセクションが終端してXMLが壊れる——`]]>` を `]]]]><![CDATA[>` に置換してから包む（CDATAを一度閉じてすぐ開き直す定石）。

本文（`body`）はフィードに含めない（§5）。

**決定**（2026-09-06）: `<category>` 要素（カテゴリ・タグ）は入れない。Zenn（`zenn.dev/zenn/feed` を直接取得して確認）・Qiita（`qiita.com/popular-items/feed.atom` を直接取得して確認）のフィードをどちらも実測したところ、両者ともタグ/カテゴリに相当する要素を一切含めていなかった——2大サービスが揃って省いている情報を足す理由がない。

## 5. 本文全文は含めない

**決定**: フィードアイテムは `description` のみを載せ、`renderMdxToHtml` によるフルレンダリングは呼ばない。

**理由**: `renderMdxToHtml`（`lib/render.ts:174-183`）は remark→rehype のフルパイプラインで、Shiki によるシンタックスハイライト（`rehype-pretty-code`）を含み、さらに `resolveCard` 経由でリンクカードごとに DB を引く可能性がある——記事1件あたり軽くない処理を、フィードリクエストのたびに直近 N 件ぶん走らせるのは重い。`description` は既に `Post` に載っている値で追加コストがゼロなので、フィードの要約にはそれで十分とする。全文配信（`content:encoded`）は将来検討（§9）。

## 6. エスケープ・依存ライブラリ

既存コードに XML エスケープのユーティリティはなく（grep で確認）、`package.json` に RSS 生成用の依存（`feed`・`rss` 等）もない。

**決定**: 新規の3rd-partyライブラリは追加せず、`lib/rss.ts` に `wrapCdata`（`]]>` 対策込み、§4）ヘルパーを自前で書く。`escapeXml`（属性値・将来の非CDATAフィールド用）も一度は書いたが、実装後のレビューで「呼び出し元が1つも無い未使用コード」と指摘され削除した（§13）——CDATA化しないフィールドが実際に増えたら、その時点で書けば足りる。

**理由**: RSS 2.0 の XML は構造が単純で、依存追加の承認プロセス（[[npm-supply-chain-hardening]]、「never bare `npm install`, no unapproved deps」）を経てまで導入する理由がない。

## 7. 配信件数・キャッシュ・discoverability

- **決定**（2026-09-06）: 配信件数はデフォルト約20件、`getAllPosts()` の結果（`date` 降順）を先頭から20件にスライスする。クエリパラメータ `?all=1` を付けると全件配信する。Zenn公式ヘルプ（`zenn.dev/zenn/articles/zenn-feed-rss`）が「デフォルトではフィードに出力される投稿の数は20ほどに制限」「`all=1` で全件出力」と明記しており、そのまま踏襲した。
- **決定**: `app/robots.ts` と同様 `export const dynamic = 'force-dynamic'` を明示する。実際に毎リクエスト DB を読む理由は Route Handler がこのバージョンではデフォルトでキャッシュされないこと自体（下記の検討で判明）にあり、`force-dynamic` はその挙動を引き起こす設定ではなく、このサイトの公開ページ（記事詳細など）と揃えるための一貫性の印——省いても実際の挙動は変わらない。

**検討して見送った案**（2026-09-06）: 公開/更新のたびに `revalidatePath('/rss.xml')` を呼び、Route Handler 側をキャッシュさせる案。`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`（"Caching" 節、"Route Handlers are not cached by default"）と `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`（"Route Handlers: Invalidates cached data accessed **within** route handlers" — 例はいずれも `fetch(..., { cache: 'force-cache' })`）を確認した結果、この機構は `fetch()` の Data Cache だけを対象にしており、`better-sqlite3` を直接呼ぶこのフィードの DB 読み取りには一切効かないと判明した。Next.js のキャッシュに乗らずに DB 負荷を下げたい場合は、モジュールスコープの自前キャッシュ（このアプリは常時起動の単一プロセスなので機能する）＋ `revalidateBlog()`（`app/actions/posts.ts`）からの明示的な無効化呼び出しを自分で書く必要がある。今回はそこまでの負荷が無いと判断し、素の `force-dynamic` のままとした。

- discoverability: `app/layout.tsx` は生の `<head>` JSX ではなく `export const metadata: Metadata = {...}`（`:19`）を使っているので、そこに `alternates: { types: { 'application/rss+xml': '/rss.xml' } }` を足す。Next.js の Metadata API（`generate-metadata.md` "alternates" 節）がこれを `<link rel="alternate" type="application/rss+xml" href="/rss.xml">` として自動的に出力する——`<link>` タグを手書きしない。

## 8. 非公開限定URL投稿との関係

本ファイル後述の「非公開限定URL投稿」は2026-09-06に実装済み（同機能 §10）——`posts` テーブルに `unlisted` 列が増え、`getAllPosts()` がそれを除外している（同機能 §4）。このフィードは `getAllPosts()` をそのまま呼ぶ設計にしてあるため、**このフィード側で `unlisted` を意識した追加コードは不要**——フィルタは `getAllPosts` 一箇所に閉じており、RSSはそれを何も知らずに継承する。

## 9. 見送った拡張・確定した細部

決定済み（2026-09-06、§4・§7）: 配信件数のデフォルト（約20件、`?all=1`で全件）、`<category>`/タグ要素は入れない。

**決定**（2026-09-06）: `lastBuildDate` はリクエスト時点の `new Date()` とする。配信対象の投稿群のうち `updatedAt` の最大値を使う案も検討したが見送った。

**理由**: (1) 投稿が0件のとき `Math.max()` が `-Infinity` を返し `Invalid Date` になる空配列バグを避けられる、(2) `lastBuildDate` を実際に参照するフィードリーダーはほぼいない（新着検知は各 `<item>` の `guid` で行われる）、(3) このフィード自体が「既存記事の更新」を伝える仕組み（RSS 2.0 の項目単位の更新日時。Atomの `<updated>` に相当するものがRSSにはない）を持たない設計なので、`lastBuildDate` だけ精密にする理由が薄い。

見送った拡張:

- Atom フィードの並行提供（§1で見送り理由を記載）。
- `content:encoded` によるフル本文配信。

## 10. Content-Type

**決定**（2026-09-06、advisorレビューで指摘）: レスポンスヘッダーは `Content-Type: application/rss+xml; charset=utf-8` を返す。`route.md` の例は `text/xml` だが、それはNext.js側の最小サンプルであってRSSの慣例ではない——§7で `alternates.types` に `'application/rss+xml'` を登録する以上、実際に配信するレスポンスの `Content-Type` もそれと一致させる（`text/html` になっていたら実装ミス、というのは以前この会話でも確認した通り）。

## 11. 受け入れ基準

[[requirements-docs-are-records]] の方針に沿い、各基準は `lib/rss.test.ts` に対応するテストケースを持つ。`lib/rss.ts` は純粋関数として書いてあるので、Route Handler自体を叩かなくても大部分を検証できる。`Content-Type` のみコードレビューでの目視確認（`app/rss.xml/route.ts` に1行、ルートハンドラのテストの前例がこのリポジトリに無いため自動テスト化は見送り）。

| 基準                                                                              | 状態                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------- |
| `title`/`description` に `]]>` が含まれてもXMLが壊れない（`wrapCdata`が閉じ直す） | 実装済み                                      |
| `slug` が `null` の行は `<item>` に含まれない                                     | 実装済み                                      |
| `date` が `''` の行は `<item>` に含まれない（`Invalid Date` を出さない）          | 実装済み                                      |
| デフォルトは新しい順に最大20件                                                    | 実装済み                                      |
| `?all=1` を付けると全件配信する                                                   | 実装済み                                      |
| 非公開限定URL投稿は出ない（`getAllPosts` 経由で自動的に満たされる）               | 実装済み（`lib/posts.test.ts`側でカバー済み） |
| `<link>`/`<guid>` に `siteOrigin` の二重スラッシュが出ない                        | 実装済み（§12の実測で発覚、修正済み）         |
| レスポンスの `Content-Type` が `application/rss+xml; charset=utf-8` である        | 実装済み（目視確認、自動テストなし）          |

## 12. 実測で発覚した不具合（2026-09-06）

実装直後、ユーザーが実際に稼働中のdev serverで `/rss.xml` を開いて出力を貼ってくれたところ、`<link>`/`<guid>` が `https://blog.example.ts.net//posts/f377f7a9a768a5b4d6f2` のように二重スラッシュになっていた。

**原因**: `siteOrigin`（`lib/site.ts:33`）は文字列ではなく `URL` オブジェクト。テンプレートリテラルに直接埋め込む（`` `${siteOrigin}/posts/...` ``）と `.toString()` が呼ばれ、`new URL('https://host').toString()` は末尾スラッシュ付きの `'https://host/'` を返す——そこに `/posts/...` を足すので二重になる。`tsc`・`lib/rss.test.ts`（当時は `siteOrigin` の値を厳密にアサートしていなかった）のどちらも検出できず、サンドボックス環境で `curl` が権限上使えなかったため自動検証もできなかった——**実際にブラウザ/実環境で見るまで気づけなかった不具合**。

**修正**: `siteOrigin` ではなく `siteOrigin.origin`（末尾スラッシュなしの文字列）を使うよう2箇所（アイテムの `<link>`、チャンネルの `<link>`）を変更。`lib/rss.test.ts` に二重スラッシュが出ないことを直接アサートする回帰テストを追加。

## 13. 独立サブエージェント3体によるレビュー（2026-09-06）

実装後、設計文書との整合性・正確性/エッジケース・テストカバレッジの3観点で独立したサブエージェントにレビューさせた。実際のバグは見つからなかった（§12の二重スラッシュは既に修正済みで、レビューはそれとは別の新規指摘）。反映したもの:

- **`escapeXml` を削除**。CDATA化しない出力フィールドが実際には1つもなく、エクスポートされているのにどこからも呼ばれていない未使用コードだった。「将来のため」に残していたが、使う段になってから書けば十分というYAGNI判断で削除。
- **`wrapCdata` に `]]>` を含まない場合のテストを追加**（自明な分岐だが未検証だった）。
- **配信件数の上限テストを強化**——「新しい順20件」というテスト名だったが、実際には件数としきい値付近2件しか確認しておらず、`&lt;item&gt;` の並び順そのものは検証していなかった。全アイテムの `<link>` からslugの並びを抽出して順序を直接アサートする形に書き換えた。
- **明示的な数値 `limit`（例: `{ limit: 5 }`）のテストを追加**——`undefined`（デフォルト20件）と `null`（全件）の2パターンしか検証しておらず、3つ目の分岐が未検証だった。

見送った(受け入れるリスクとして記録するに留めた)指摘:

- **制御文字（0x00–0x1F等）が CDATA でも除去されない**——CDATAはXML的に不正な制御文字を合法にはしない。ただし技術ブログの著者が書く`title`/`description`にこの種の文字が混入するのは、PDFからの不用意なコピペ等の非常に稀なケースに限られる。除去ロジックを足すコストに見合わないと判断し、既知の受容リスクとして記録するに留めた。
- **`buildRssFeed` の `limit` に負数を渡すと `Array.slice` の負インデックス挙動で末尾から削れる**——現状 `app/rss.xml/route.ts` は `null` か `undefined` しか渡さず、`?limit=` のようなクエリは存在しないため到達不能。到達可能になった時点（`limit` をユーザー入力から受け取るようになった場合）で対処すればよい。
- **`<language>ja</language>` と `<?xml ... encoding="UTF-8"?>` は §1–§9 のどの決定にも明記されていなかった**——見落としではなく、RSS 2.0のチャンネル要素として一般的なため実装時に加えた。ここに明記することで正式な決定として記録する。

---

# 非公開限定URL投稿

状態: **エディタ・管理画面・スキーマまで実装済み**（2026-09-06）。RSS フィード（本ファイル前述）は未実装のまま。
作成: 2026-09-06、着手前に書いている
関連: 本ファイル内「RSS/Atom フィード」§8（相互参照）

## 1. 目的とスコープ

公開済みの投稿を、ホーム・タグ・カテゴリの一覧や RSS フィードから除外しつつ、直接 URL を知っていれば読める状態にする。認証によるアクセス制御ではなく、「一覧に出さない」ことと「URL が推測不能である」ことの組み合わせだけで成立させる。

## 2. なぜ opaque な slug だけで成立するか

`lib/slug.ts:5-10` のコメントがこの機能を見越して書かれている:

> "Every post's public URL is an auto-assigned opaque slug: 20 hex chars (80 bits of full entropy from crypto.randomBytes — not a UUID, whose fixed version and variant nibbles would waste ~6 bits). Assigned once at row creation and never shown or edited by the author, so the URL is also unguessable (**a forward-looking property for future unlisted posts**)."

`getPostBySlug`（`lib/posts.ts:42-46`）は `draft` 以外に何もフィルタしていない——認証チェックも一切ない。つまり非公開URL投稿の「アクセス制御」の実体は、80bit のエントロピーを持つ slug が第三者に推測不可能であることそのもの。もし slug が連番やタイトル由来だったら、一覧から消しても総当たりや推測で読めてしまい、この機能は成立しない。

## 3. スキーマ変更

`posts` テーブル（`lib/db/schema.ts`）の末尾に `unlisted` 列を追加する:

```ts
unlisted: integer('unlisted', { mode: 'boolean' }).notNull().default(false),
```

`thumbnail` 列（`lib/db/schema.ts:41`）より後ろ、テーブル定義の最後に置く。理由は `draftContent`・`thumbnail` と同じ制約——このテーブルは drizzle-kit push が壊れており、ALTER TABLE ADD COLUMN として末尾に足す形以外のスキーマ変更は本番 DB に反映できない（`lib/db/schema.ts:32-33`、`:39-40` のコメント）。

**実行手順は検証済み**（2026-09-06）。このリポジトリは `drizzle-kit push` を使わず、`scripts/migrate-db.mts:11-16` のコメントに理由がある——`push` は本番DBを直接diffし、SQLiteがその場でALTERできない変更は「テーブル作り直し」(create→copy→drop→rename)にすり替える。`posts` テーブルではユニークインデックスを2回発行して途中で止まる。代わりのワークフローは `lib/db/schema.ts` を編集 → `npx drizzle-kit generate`（`drizzle/NNNN_*.sql` を生成） → 生成されたSQLを目視確認 → `npm run db:backup && npm run db:migrate`。

末尾への列追加はこの本番DBに対してすでに3回実績がある——`drizzle/0002_thin_starfox.sql`（`thumbnail` 追加）、`0004`・`0005`（`link_previews` への列追加）はいずれも素の `ALTER TABLE ... ADD ... NOT NULL DEFAULT ...` で、適用済み。`unlisted` も同じ形（`ALTER TABLE posts ADD unlisted integer DEFAULT false NOT NULL`）になる見込みで、安全に進められる。

## 4. 一覧クエリの変更

| 関数                                                                                          | ファイル:行               | 変更                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAllPosts`                                                                                 | `lib/posts.ts:36`         | `.where(eq(posts.draft, false))` → `and(eq(posts.draft, false), eq(posts.unlisted, false))`                                                                                                                                                 |
| `getPostsByCategory`                                                                          | `lib/posts.ts:85`         | 同様に `eq(posts.unlisted, false)` を `and()` に追加                                                                                                                                                                                        |
| `getPostsByTag`・`getAllTags`・`getAllCategories`                                             | `lib/posts.ts:77,110,115` | いずれも内部で `getAllPosts()` を呼ぶだけなので変更不要——`getAllPosts` のフィルタをそのまま継承する                                                                                                                                         |
| `getPostBySlug`                                                                               | `lib/posts.ts:42-46`      | **変更しない**——`draft` 以外のフィルタを持たないことが、直接URLアクセスを成立させている本体（§2）                                                                                                                                           |
| `listAllPosts`（管理画面）                                                                    | `lib/posts.ts:48-51`      | **変更しない**——`.where()` を持たず全件返す。下書きと同じ「隠さず、印を付ける」方針（`app/api/posts/search/route.ts:35-37` が下書きについて述べる方針を unlisted にも適用する）を踏襲し、一覧はそのまま出して管理画面にバッジを付ける（§6） |
| `app/api/posts/search/route.ts`（リンクカードの自著記事検索、`:38` で `listAllPosts` を使用） | —                         | **変更しない**——`getOptionalSession`（`:27`）で認証済みの著者本人しか叩けないので、下書きと同様 unlisted も見えたままでよい                                                                                                                 |

## 5. 投稿の作成・保存経路

`app/actions/posts.ts` の `contentSchema`（`:18-30`）に `unlisted: z.boolean()` を `thumbnail`（`:29`）の隣に追加する。`parseContent` を経て `createPost`/`updatePost`/`commitPost`（`lib/posts-write.ts`、呼び出しは `app/actions/posts.ts` 内）まで運ぶ。

`app/actions/posts.ts:15` のコメント「Editable content (no slug, no visibility flag)」は実装時に古くなる——このコメントは現状「visibility flag がない」ことの記録そのものなので、`unlisted` を追加した瞬間に間違いになる。実装時に書き換えること。

**注意**: `parseContent`（`app/actions/posts.ts:59-66`）は全フィールドを `field(formData, name)` 経由の文字列として取り出しており、`field()`（`:45-48`）はチェックボックスが未チェックのとき（`formData.get` が `null` を返すため）`''` を返す。`unlisted: z.boolean()` をそのまま足しても動かないので、`unlisted: field(formData, 'unlisted') === 'on'` のように明示的に boolean へ変換して渡すこと。

## 6. エディタUIと管理画面

- エディタ（`components/PostEditor.tsx`）には既存の ON/OFF トグルがない。公開状態は `intent=publish`/`intent=unpublish`（`:415-431`）という送信ボタンの意図で切り替えている。`ThumbnailField.tsx` のような「隠し input にミラーする」パターンは、外部ピッカー UI が JS で値を書き換える場合に要るものなので、ここでは不要——ユーザーが直接クリックするただの `<input type="checkbox" name="unlisted">` で足りる。
- **仮決定**（2026-09-06、モックアップで確認）: チェックボックスは一旦サムネイル欄の右隣に置く。説明文（補足テキスト）は付けない——「限定公開にする」のラベルのみで足りる。配置は「仮」——サムネイル欄の直下案もモックアップで一度試している。
- 管理画面（`app/admin/page.tsx`）の一覧には、下書きバッジ（`post.draft &&` 分岐、`bg-amber-100 ... text-amber-800 ... 下書き`）と同じ位置に、unlisted 用のバッジを並べる。
- **決定**（2026-09-06）: 配色は紫系（violet）で確定。下書きバッジの amber と衝突しない。文言は「限定公開」で仮置き（バッジの正確な文言は§8で未決のまま）。

## 7. RSSフィードとの関係

「RSS/Atom フィード」（本ファイル前述、§8）は `getAllPosts()` をそのまま呼ぶ設計にしてある。この機能が入れば、`getAllPosts` のフィルタ変更（§4）だけでフィードからも自動的に除外される——フィード側に追加の変更は要らない。

サイトマップ（`app/sitemap.ts`）は現状存在しない。将来作る場合は、同じ `unlisted` フィルタを共有すること。

## 8. 受け入れ基準・未決事項

| 基準                                                                  | 状態                                         |
| --------------------------------------------------------------------- | -------------------------------------------- |
| ホーム/タグ/カテゴリの一覧に出ない                                    | 実装済み（`lib/posts.test.ts`、§10）         |
| RSSフィードに出ない（§7、`getAllPosts` 経由で自動的に満たされる）     | フィード自体が未実装                         |
| 直接URL（`/posts/<slug>`）からは読める                                | 実装済み（`lib/posts.test.ts`、§10）         |
| 管理画面の一覧には出る（バッジ付き）                                  | 実装済み（`app/admin/page.tsx`、§10）        |
| リンクカードの自著記事検索には出る（`app/api/posts/search/route.ts`） | 未変更のまま満たされる（意図的に手を付けず） |

決定（2026-09-06、§6）: 説明文なし、配色（紫系）。チェックボックスの配置は仮決定（サムネイル欄の右隣）。

未決: バッジの正確な文言（「限定公開」で仮置き。「非公開URL」など他の言い回しも検討可）。

**決定**（2026-09-06）: 既存の公開済み投稿を後から unlisted 化しても、特別な移行処理はしない——新規投稿を最初から unlisted にする場合と完全に同じ扱いでよい。

**理由**: 「すでに公開済みだった」ことに起因する懸念は次の2つだが、どちらもアクセス制御の方式（unlisted か private か）を変えても解決しない、システムの外側の問題だから。

1. **検索エンジンには残る**——すでにインデックスされたページは、unlisted 化しても自動では消えない。Private（読者認証）にしても、検索結果の項目自体はGoogle側の再クロール待ちか、Search Console での削除申請でしか消せない——アクセス制御とは独立した別作業。しかも Private を作るには読者認証・招待リスト管理という今のブログにない仕組み一式が要り（現状は管理者ログインのみ、読者向け認証機能は構想止まりで未着手）、この懸念のためだけに実装する投資ではない。
2. **既存のRSS購読者には残る**——配信済みのフィードアイテムは購読者のリーダーにローカルで残り、サーバー側の設定変更では回収できない。RSS という仕組み自体に配信済みアイテムを取り消す手段がない。

**参考**: YouTube の「限定公開」も同型の設計（不透明なURL＋自サイト内検索から除外、認証なし）だが、限定公開URLが外部ページに貼られると、そのページをGoogleがクロールして検索に出てしまうことがあると公式ヘルプが明記している（`support.google.com/youtube/answer/9230970`）。YouTube は2021年、2017年以前の限定公開動画を一括で強制 Private 化するセキュリティアップデートまで行っており、「不透明URL＋非掲載」だけに頼る手法は年月とともに実質的な秘匿性が劣化しうることの実例——ただし YouTube 規模の話で、個人ブログでそこまでの対策（経年での強制切り替えなど）を用意する必要はないと判断する。

## 10. 実装メモ（2026-09-06）

エディタ・管理画面・スキーマまで実装済み。RSS フィード（本ファイル前述）は未実装のまま——§7 の通り `getAllPosts()` を経由するので、実装済みの `unlisted` フィルタを自動的に継承する。

- **スキーマ**: `lib/db/schema.ts` に `unlisted` 列を追加し、`drizzle-kit generate` → `drizzle/0006_stormy_crystal.sql`（`ALTER TABLE posts ADD unlisted integer DEFAULT false NOT NULL;`、想定どおりの素の ALTER）→ `npm run db:backup` → `npm run db:migrate` で本番DBに適用済み（3件の既存投稿は全て `unlisted=0`）。
- **クエリ**: `lib/posts.ts` の `getAllPosts`・`getPostsByCategory` にフィルタを追加。`toPost` に `unlisted` を追加。`toDraftContent`（`lib/posts.ts`）に `unlisted: stored.unlisted ?? false` を追加——`thumbnail` の前例（§本文参照）と同じ「古い working copy に新フィールドが無い」問題を先回りで塞いだ。
- **保存経路**: `app/actions/posts.ts` の `contentSchema` に `unlisted: z.boolean()` を追加、`parseContent` で `field(formData, 'unlisted') === 'on'` に変換（チェックボックス未チェック時は FormData に値自体が現れない点への対処）。`app/api/drafts/route.ts` の `autosaveSchema` にも同じ形で追加——オートセーブは `components/editor/useAutosave.ts` の `readDraftContent` が別途フォームを読むので、そちらにも同じ変換を追加。`:15` のコメントは書き換え済み。
- **エディタUI**: `components/PostEditor.tsx` に「公開範囲」ラベル＋「限定公開にする」チェックボックスを追加。配置は仮決定どおりサムネイル欄の直後（2列グリッドの隣のセル）。素の `<input type='checkbox' name='unlisted'>` で、`ThumbnailField` のような隠し input のミラーは使っていない（§6 の判断どおり）。アクセントは Tailwind の `accent-violet-600`。
- **管理画面**: `app/admin/page.tsx` に下書きバッジと並べて `bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300` の「限定公開」バッジを追加。
- **テスト**: `lib/posts.test.ts` に一覧からの除外・直接URLアクセス・管理画面での可視性・`toDraftContent` の後方互換の4種を追加。`lib/posts-write.test.ts`・`lib/posts.test.ts` 双方の既存フィクスチャに `unlisted` を追加して型を合わせた。`npx tsc --noEmit`・`npx vitest run`（486件）・`npm run build`（Next.js 本番ビルド）はすべて通過。
- **未変更（意図的）**: `getPostBySlug`・`listAllPosts`・`app/api/posts/search/route.ts` は§4の設計どおり無変更。
- **未実装のまま残る決定事項**: バッジ・チェックボックスの正確な文言（「限定公開」で仮置きのまま出荷）、チェックボックス配置の最終確定（現状は仮決定のまま）。
