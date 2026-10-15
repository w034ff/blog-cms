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

**決定**: remark/unified の AST を組んで走査するのではなく、`lib/footnotes.ts` の `incompleteFootnotes`と同じ「行ベースの正規表現スキャン」で実装する。新規モジュール `lib/reading-time.ts` に `estimateReadingTime(body: string): number` を1つだけ置く（`lib/slug.ts` と同じ、小さく単機能な `lib/*.ts` の流儀）。

**理由**: ホーム・タグ・カテゴリの一覧画面は記事ごとに `renderMdxToHtml`（`lib/render.ts`）を呼んでいない。一覧の読了時間表示のためだけに、記事1件ごとに remark→rehype のフル変換を余分に走らせるのは重い。「詳細ページだけ既存 AST を再利用し、一覧はスキャンで済ます」という案も検討したが、それだと同じ記事で一覧の値（スキャン）と詳細の値（AST）が食い違いうる——同じ記事はどの画面でも同じ「約n分」を出すべきなので（§6）、全画面で共通の軽量関数に統一する。

`lib/footnotes.ts` の冒頭コメントがまったく同じ判断をすでに一度書いている:「Deliberately a scan rather than a parse. Pulling markdown-it in here would mean the editor's parser... loading in a server action to answer a yes/no question about two line shapes.」——読了時間もこれと同じ形の問い（この行は地の文か否か）である。

一覧クエリ側の懸念（`body` 列を追加取得する必要があるか）は解消済み: `getAllPosts`/`listAllPosts`/`getPostBySlug`（`lib/posts.ts`）はいずれも `db.select()`（列指定なし）で全列を取得しており、`toPost`（`lib/posts.ts`）が `body: row.body` をそのまま `Post` に渡している。一覧側にクエリ変更は不要——`PostCard` はすでに完全な本文を手にしている。

### 3.2 除外ルールの実装

- フェンス判定は `lib/footnotes.ts` の `FENCE`（`` /^ {0,3}(`{3,}|~{3,})/` ``）と同じ形で、フェンス内の行を読み飛ばす。
- `^<div class="(link-card|embed)"[^>]*></div>$` に一致する行は1行まるごと除外する。この形は実装が実際に吐く形そのもの——`components/editor/link-card-extension.ts` の `serializeLinkCard` と `components/editor/embed-extension.ts` の `serializeEmbed` がそれぞれ `` `<div class="link-card" data-href="${escapeAttribute(href)}"></div>` `` / `` `<div class="embed" data-href="${escapeAttribute(href)}"></div>` `` を `state.write` している。
- 脚注参照 `[^label]`（`lib/footnotes.ts` の `REFERENCE`）はマッチした部分を文字列から取り除く。定義行 `[^label]: text`（`lib/footnotes.ts` の `DEFINITION`）はラベル部分だけ剥がし、本文（`text`）は残す。
- 改行は `/\r?\n/` で分割する。`\n` 単独ではないのは `lib/footnotes.ts` の `incompleteFootnotes` と同じ理由——フォーム送信が値の改行を CRLF に書き換える（`docs/editor-pitfalls.md` §16.1）ため、`\r` が行末に残ったままだと後段の正規表現が丸ごと外れる。

### 3.3 文字数/単語数から分への換算

**決定**: 除外処理を終えた文字列から、まず CJK文字（ひらがな U+3040–309F、カタカナ U+30A0–30FF、CJK統合漢字 U+4E00–9FFF、全角句読点等 U+3000–303F・U+FF01–FF60、繰り返し記号「々」「ー」）をすべて取り除きながら1文字ずつ数える。取り除いた残り（半角英数字・記号・その他）を空白/CJK境界で分割し、空でないトークンを「単語」として数える。

分 = `Math.ceil(CJK文字数 / 500 + 単語数 / 200)`、最小 1分（0分・空文字列でも「約1分」を下限にする）。

**日本語文にはスペースがないため、生の文字列を先に空白分割してから振り分ける実装は誤り**——スペース区切りの単語カウントを地の文全体にかけると、句読点のない日本語の段落1つが「1単語」として扱われ、読了時間が実質ゼロ扱いになる。必ず「CJK文字を1文字ずつ抜き出して残りだけをトークン化する」の順で実装する。

**未検証**: 500字/分（CJK）・200語/分（非CJK）はどちらも実測ではなく、一般的な黙読速度の目安値。実装しなかったため較正の機会もなかった。

画像・埋め込み1件あたりに固定秒数を加算する方式（dev.to 等で知られる）は初期実装では見送る想定だった（§7）。

## 4. 表示場所（想定）

| 画面 | ファイル | 挿入位置 |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ----------------------------------------------------------------------------------- |
| ホーム/タグ/カテゴリの一覧行 | `components/PostCard.tsx` | `<time dateTime={post.date}>{formatPostDate(post.date)}</time>` と category リンクを並べている `flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500` 行（`components/PostCard.tsx`）に、同じスタイルの inline 項目として追加 |
| 記事詳細ページのヘッダー | `components/PostArticle.tsx` | 上と同じ構造を持つヘッダー内の行（`<time dateTime={post.date}>{formatPostDate(post.date)}</time>` — `components/PostArticle.tsx`）に追加 |
| 管理画面の記事一覧 | `app/admin/(list)/PostListRows.tsx` | `{post.slug} · {formatPostDateTime(post.date)                                                                                                                                                                                              |     | '未公開'} · {post.category}` の行（`app/admin/(list)/PostListRows.tsx`）に `·` 区切りで追加 |

いずれも `estimateReadingTime(post.body)` を直接呼ぶ想定だった（§3.1 の通り、`body` はどの画面でもすでに手元にある）。

## 5. 計算タイミングと永続化しない理由

**決定**: DB に列を追加せず、`body` から都度計算する純粋関数として実装する。

**理由**: 保存する場合、本文を更新するたびに読了時間を再計算して書き戻す同期コードが要る。しかもそれは `draftContent` で実際に踏んだ不具合のクラス——「後から足したフィールドが古い行では読めない」（`docs/editor-pitfalls.md` §16.2、`lib/draft-content.ts` の `normalizeDraftContent`がまさにその埋め合わせ）——をもうひとつ増やすだけになる。読了時間は本文だけから決まる純粋な値で、行スキャン自体が軽いので、都度計算のコストは無視できる。

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

`app/sitemap.ts` は存在しない（確認済み）。`app/robots.ts` は存在するが、`siteIndexable`（`lib/site.ts`）による許可/拒否ポリシーを返すだけの静的な実装で、投稿を1件もクエリしていない——「全投稿を機械可読に列挙する」既存の前例としては使えず、フィード用のクエリはこの機能で新規に書く。

## 3. データソースとサイトメタ情報

- 投稿一覧: `getAllPosts()`（`lib/posts.ts`）をそのまま使う。すでに `draft=false` かつ `unlisted=false` でフィルタ済み（非公開限定URL投稿 §4 で追加）、`date` 降順。`Post` 型（`lib/types.ts`）に `title`・`slug`・`date`・`description`・`category`・`tags`・`body` に加えて `unlisted`・`updatedAt`（いずれも2026-09-06追加）も載っているが、このフィードが使うのは前者のみ——`unlisted` は `getAllPosts` のフィルタで既に処理済み、`updatedAt` は§4の決定によりフィードに出さない。追加クエリは不要。
- サイト起点 URL: `siteOrigin`（`lib/site.ts`、`SITE_ORIGIN` 環境変数、既定 `http://localhost:3001`）。`app/layout.tsx` の `metadataBase: siteOrigin` と同じ値を使う。
- サイト名/概要: `SITE_NAME = 'Small Diffs'`・`SITE_DESCRIPTION = '個人技術ブログ'`（`app/shared-metadata.ts`）。

## 4. 各アイテムの内容

**注意**（2026-09-06、advisorレビューで指摘）: 以下の2つは静かにXMLを壊す/読者向けの主要フィールドを汚す経路なので、実装時に必ず塞ぐこと。

- `post.slug` は `string | null` 型（`lib/types.ts` の `Post.slug`、「in practice always set」というコメント付き）。`` `${siteOrigin}/posts/${post.slug}` `` のようにそのまま埋め込むと、万一 `null` の行があった場合 `/posts/null` という URL が `<link>`/`<guid>` にそのまま出力されてしまう——TypeScript はテンプレートリテラルへの `null` 埋め込みを型エラーにしない。**フィード組み立て時に `post.slug !== null` でフィルタする**（`getAllPosts()` が返す行は公開済みで実質必ず slug を持つはずだが、型がそう主張していない以上、実装側で明示的に弾く）。
- `post.date` が `''`（未公開の sentinel）だと `new Date('').toUTCString()` は例外を投げず、文字列 `"Invalid Date"` を返す——これがそのまま `<pubDate>` に出ると多くのフィードバリデータで検証エラーになる。`getAllPosts()` は `draft=false` のみ返すので理論上 `date` は必ず設定済みだが、同じ理由（型が保証していない）で `date !== ''` をアイテム構築時にもう一度確認する。

- `<title>`: `post.title`
- `<link>` / `<guid isPermaLink="true">`: `${siteOrigin}/posts/${post.slug}`（上記の null チェック後）
- `<pubDate>`: `new Date(post.date).toUTCString()`。Zenn実測のフィードで確認した実際の出力形（`Mon, 03 Aug 2026 09:18:05 GMT`）と一致する——「RFC 822 形式に変換」を自前でフォーマットする必要はなく、`toUTCString()` 一発でよい。`post.updatedAt`（2026-09-06に追加、公開ページの「更新: …」表示の元になった列——本ファイルの「投稿日と更新日の表示」を参照）は載せない。Zenn自身のフィード（`zenn.dev/zenn/feed` 実測）も、サイト側では更新日を出しているのにフィードには入れていない——ページの表示とフィードの項目は必ずしも一致させなくてよい前例。
- `<title>` / `<description>`: どちらも CDATA で包む（Zenn実測でも両方CDATA——`title`にも `&`/`<`/`>` が普通に入りうる技術ブログなので、`escapeXml` の個別エスケープより一律CDATAのほうが手書きミスの余地が小さい）。`<link>`/`<guid>` はスラッグが16進文字列で `&`等を含みえないため素の文字列でよい。
- **注意**: CDATAで包む文字列自体に `]]>` が含まれると、そこでCDATAセクションが終端してXMLが壊れる——`]]>` を `]]]]><![CDATA[>` に置換してから包む（CDATAを一度閉じてすぐ開き直す定石）。

本文（`body`）はフィードに含めない（§5）。

**決定**（2026-09-06）: `<category>` 要素（カテゴリ・タグ）は入れない。Zenn（`zenn.dev/zenn/feed` を直接取得して確認）・Qiita（`qiita.com/popular-items/feed.atom` を直接取得して確認）のフィードをどちらも実測したところ、両者ともタグ/カテゴリに相当する要素を一切含めていなかった——2大サービスが揃って省いている情報を足す理由がない。

## 5. 本文全文は含めない

**決定**: フィードアイテムは `description` のみを載せ、`renderMdxToHtml` によるフルレンダリングは呼ばない。

**理由**: `renderMdxToHtml`（`lib/render.ts`）は remark→rehype のフルパイプラインで、Shiki によるシンタックスハイライト（`rehype-pretty-code`）を含み、さらに `resolveCard` 経由でリンクカードごとに DB を引く可能性がある——記事1件あたり軽くない処理を、フィードリクエストのたびに直近 N 件ぶん走らせるのは重い。`description` は既に `Post` に載っている値で追加コストがゼロなので、フィードの要約にはそれで十分とする。全文配信（`content:encoded`）は将来検討（§9）。

## 6. エスケープ・依存ライブラリ

既存コードに XML エスケープのユーティリティはなく（grep で確認）、`package.json` に RSS 生成用の依存（`feed`・`rss` 等）もない。

**決定**: 新規の3rd-partyライブラリは追加せず、`lib/rss.ts` に `wrapCdata`（`]]>` 対策込み、§4）ヘルパーを自前で書く。`escapeXml`（属性値・将来の非CDATAフィールド用）も一度は書いたが、実装後のレビューで「呼び出し元が1つも無い未使用コード」と指摘され削除した（§13）——CDATA化しないフィールドが実際に増えたら、その時点で書けば足りる。

**理由**: RSS 2.0 の XML は構造が単純で、依存追加の承認プロセス（`docs/dev-environment.md` §4、「never bare `npm install`, no unapproved deps」）を経てまで導入する理由がない。

## 7. 配信件数・キャッシュ・discoverability

- **決定**（2026-09-06）: 配信件数はデフォルト約20件、`getAllPosts()` の結果（`date` 降順）を先頭から20件にスライスする。クエリパラメータ `?all=1` を付けると全件配信する。Zenn公式ヘルプ（`zenn.dev/zenn/articles/zenn-feed-rss`）が「デフォルトではフィードに出力される投稿の数は20ほどに制限」「`all=1` で全件出力」と明記しており、そのまま踏襲した。
- **決定**: `app/robots.ts` と同様 `export const dynamic = 'force-dynamic'` を明示する。実際に毎リクエスト DB を読む理由は Route Handler がこのバージョンではデフォルトでキャッシュされないこと自体（下記の検討で判明）にあり、`force-dynamic` はその挙動を引き起こす設定ではなく、このサイトの公開ページ（記事詳細など）と揃えるための一貫性の印——省いても実際の挙動は変わらない。

**検討して見送った案**（2026-09-06）: 公開/更新のたびに `revalidatePath('/rss.xml')` を呼び、Route Handler 側をキャッシュさせる案。`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`（"Caching" 節、"Route Handlers are not cached by default"）と `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`（"Route Handlers: Invalidates cached data accessed **within** route handlers" — 例はいずれも `fetch(..., { cache: 'force-cache' })`）を確認した結果、この機構は `fetch()` の Data Cache だけを対象にしており、`better-sqlite3` を直接呼ぶこのフィードの DB 読み取りには一切効かないと判明した。Next.js のキャッシュに乗らずに DB 負荷を下げたい場合は、モジュールスコープの自前キャッシュ（このアプリは常時起動の単一プロセスなので機能する）＋ `revalidateBlog()`（`app/actions/posts.ts`）からの明示的な無効化呼び出しを自分で書く必要がある。今回はそこまでの負荷が無いと判断し、素の `force-dynamic` のままとした。

- discoverability: `app/layout.tsx` は生の `<head>` JSX ではなく `export const metadata: Metadata = {...}` を使っているので、そこに `alternates: { types: { 'application/rss+xml': '/rss.xml' } }` を足す。Next.js の Metadata API（`generate-metadata.md` "alternates" 節）がこれを `<link rel="alternate" type="application/rss+xml" href="/rss.xml">` として自動的に出力する——`<link>` タグを手書きしない。

### 7.1 `revalidateBlog()` はこのサイトでは何も無効化しない（実測 2026-09-14）

§7 は `revalidatePath` が `fetch()` の Data Cache にしか効かないことを示した。残る候補はブラウザのクライアントキャッシュ（`node_modules/next/dist/docs/01-app/04-glossary.md` の "Client Cache" 節、"stores RSC Payload for visited and prefetched routes"）だが、**こちらも保持していない。**

**機構**: `staleTimes` の `dynamic` は既定 0 秒（`staleTimes.md` の Version History、"The `dynamic` `staleTimes` default changed from 30s to 0s"）で、公開・管理ルートは10箇所すべて `force-dynamic`。保持されるものが無いので、無効化する対象も無い。

**測り方**: `e2e/revalidate-client-cache.spec.ts` を**本番ビルド**（`next build` + `next start`、`E2E_EXTERNAL_SERVER=1`）に対して走らせる。自動プリフェッチは本番でしか動かない（`prefetching.md`、"Automatic prefetching runs only in production"）ため `next dev` では答えが出ない。`revalidateBlog()` の中身を消したビルドと消さないビルドで A/B したが、`/admin`・`/`・`/posts/[slug]` を `<Link>` だけで巡る経路の結果は同一だった。対照として Server Action を介さない直接 UPDATE を DB に書いても、3面とも新しい値が見えた——クライアントキャッシュに古い payload が残っていないことの確認である。

**決定**: 呼び出しは4箇所とも残す。位置づけは `force-dynamic` と同じ一貫性の印で、§7 が書いたモジュールスコープの自前キャッシュを将来足すなら、その無効化フックはここになる。

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

AGENTS.md「Requirements documents」の方針（表とコードを照合するテストで保つ）に沿い、各基準は `lib/rss.test.ts` に対応するテストケースを持つ。`lib/rss.ts` は純粋関数として書いてあるので、Route Handler自体を叩かなくても大部分を検証できる。`Content-Type` のみコードレビューでの目視確認（`app/rss.xml/route.ts` に1行、ルートハンドラのテストの前例がこのリポジトリに無いため自動テスト化は見送り）。

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

実装直後、ユーザーが実際に稼働中のdev serverで `/rss.xml` を開いて出力を貼ってくれたところ、`<link>`/`<guid>` が `https://<公開ホスト>//posts/f377f7a9a768a5b4d6f2` のように二重スラッシュになっていた。

**原因**: `siteOrigin`（`lib/site.ts`）は文字列ではなく `URL` オブジェクト。テンプレートリテラルに直接埋め込む（`` `${siteOrigin}/posts/...` ``）と `.toString()` が呼ばれ、`new URL('https://host').toString()` は末尾スラッシュ付きの `'https://host/'` を返す——そこに `/posts/...` を足すので二重になる。`tsc`・`lib/rss.test.ts`（当時は `siteOrigin` の値を厳密にアサートしていなかった）のどちらも検出できず、サンドボックス環境で `curl` が権限上使えなかったため自動検証もできなかった——**実際にブラウザ/実環境で見るまで気づけなかった不具合**。

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

状態: **UI は廃止**（2026-09-21、§11）。列と一覧クエリのフィルタだけが残っている。実装は 2026-09-06。
作成: 2026-09-06、着手前に書いている
関連: 本ファイル内「RSS/Atom フィード」§8（相互参照）

## 1. 目的とスコープ

公開済みの投稿を、ホーム・タグ・カテゴリの一覧や RSS フィードから除外しつつ、直接 URL を知っていれば読める状態にする。認証によるアクセス制御ではなく、「一覧に出さない」ことと「URL が推測不能である」ことの組み合わせだけで成立させる。

## 2. なぜ opaque な slug だけで成立するか

`lib/slug.ts` の `generateUniqueSlug` のコメントがこの機能を見越して書かれている:

> "Every post's public URL is an auto-assigned opaque slug: 20 hex chars (80 bits of full entropy from crypto.randomBytes — not a UUID, whose fixed version and variant nibbles would waste ~6 bits). Assigned once at row creation and never shown or edited by the author, so the URL is also unguessable (**a forward-looking property for future unlisted posts**)."

`getPostBySlug`（`lib/posts.ts`）は `draft` 以外に何もフィルタしていない——認証チェックも一切ない。つまり非公開URL投稿の「アクセス制御」の実体は、80bit のエントロピーを持つ slug が第三者に推測不可能であることそのもの。もし slug が連番やタイトル由来だったら、一覧から消しても総当たりや推測で読めてしまい、この機能は成立しない。

## 3. スキーマ変更

`posts` テーブル（`lib/db/schema.ts`）の末尾に `unlisted` 列を追加する:

```ts
unlisted: integer('unlisted', { mode: 'boolean' }).notNull().default(false),
```

`thumbnail` 列（`lib/db/schema.ts`）より後ろ、テーブル定義の最後に置く。理由は `draftContent`・`thumbnail` と同じ制約——このテーブルは drizzle-kit push が壊れており、ALTER TABLE ADD COLUMN として末尾に足す形以外のスキーマ変更は本番 DB に反映できない（`lib/db/schema.ts` の `draftContent`・`thumbnail` のコメント）。

**実行手順は検証済み**（2026-09-06）。このリポジトリは `drizzle-kit push` を使わず、`scripts/migrate-db.mts` の冒頭コメントに理由がある——`push` は本番DBを直接diffし、SQLiteがその場でALTERできない変更は「テーブル作り直し」(create→copy→drop→rename)にすり替える。`posts` テーブルではユニークインデックスを2回発行して途中で止まる。代わりのワークフローは `lib/db/schema.ts` を編集 → `npx drizzle-kit generate`（`drizzle/NNNN_*.sql` を生成） → 生成されたSQLを目視確認 → `npm run db:backup && npm run db:migrate`。

末尾への列追加はこの本番DBに対してすでに3回実績がある——`drizzle/0002_thin_starfox.sql`（`thumbnail` 追加）、`0004`・`0005`（`link_previews` への列追加）はいずれも素の `ALTER TABLE ... ADD ... NOT NULL DEFAULT ...` で、適用済み。`unlisted` も同じ形（`ALTER TABLE posts ADD unlisted integer DEFAULT false NOT NULL`）になる見込みで、安全に進められる。

## 4. 一覧クエリの変更

| 関数                                                                                 | ファイル       | 変更                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAllPosts`                                                                        | `lib/posts.ts` | `.where(eq(posts.draft, false))` → `and(eq(posts.draft, false), eq(posts.unlisted, false))`                                                                                                                                                                     |
| `getPostsByCategory`                                                                 | `lib/posts.ts` | 同様に `eq(posts.unlisted, false)` を `and()` に追加                                                                                                                                                                                                            |
| `getPostsByTag`・`getAllTags`・`getAllCategories`                                    | `lib/posts.ts` | いずれも内部で `getAllPosts()` を呼ぶだけなので変更不要——`getAllPosts` のフィルタをそのまま継承する                                                                                                                                                             |
| `getPostBySlug`                                                                      | `lib/posts.ts` | **変更しない**——`draft` 以外のフィルタを持たないことが、直接URLアクセスを成立させている本体（§2）                                                                                                                                                               |
| `listAllPosts`（管理画面）                                                           | `lib/posts.ts` | **変更しない**——`.where()` を持たず全件返す。下書きと同じ「隠さず、印を付ける」方針（`app/api/posts/search/route.ts` の `listAllPosts` 呼び出しが下書きについて述べる方針を unlisted にも適用する）を踏襲し、一覧はそのまま出して管理画面にバッジを付ける（§6） |
| `app/api/posts/search/route.ts`（リンクカードの自著記事検索、`listAllPosts` を使用） | —              | **変更しない**——`getOptionalSession` で認証済みの著者本人しか叩けないので、下書きと同様 unlisted も見えたままでよい                                                                                                                                             |

## 5. 投稿の作成・保存経路

保存経路は `unlisted` を運ばない（2026-09-21、§11）。`app/actions/posts.ts` の `contentSchema`、`app/api/drafts/route.ts` の `autosaveSchema`、`useAutosave` の `readDraftContent`、`DraftContent`、`PostInput` のどれにもフィールドが無いので、公開・更新・自動保存のいずれも列に触れず、列は既定値の `false` のまま残る。

## 6. エディタUIと管理画面

エディタにも管理画面の一覧にも、限定公開の操作と表示は無い（2026-09-21、§11）。

## 7. RSSフィードとの関係

「RSS/Atom フィード」（本ファイル前述、§8）は `getAllPosts()` をそのまま呼ぶ設計にしてある。この機能が入れば、`getAllPosts` のフィルタ変更（§4）だけでフィードからも自動的に除外される——フィード側に追加の変更は要らない。

サイトマップ（`app/sitemap.ts`）は現状存在しない。将来作る場合は、同じ `unlisted` フィルタを共有すること。

## 8. 受け入れ基準・未決事項

| 基準                                                                  | 状態                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| ホーム/タグ/カテゴリの一覧に出ない                                    | 実装済み（`lib/posts.test.ts`、§10）                     |
| RSSフィードに出ない（§7、`getAllPosts` 経由で自動的に満たされる）     | フィード自体が未実装                                     |
| 直接URL（`/posts/<slug>`）からは読める                                | 実装済み（`lib/posts.test.ts`、§10）                     |
| 管理画面の一覧には出る                                                | 満たされる（`listAllPosts` は全件。バッジは §11 で廃止） |
| リンクカードの自著記事検索には出る（`app/api/posts/search/route.ts`） | 未変更のまま満たされる（意図的に手を付けず）             |

**決定**（2026-09-06）: 既存の公開済み投稿を後から unlisted 化しても、特別な移行処理はしない——新規投稿を最初から unlisted にする場合と完全に同じ扱いでよい。

**理由**: 「すでに公開済みだった」ことに起因する懸念は次の2つだが、どちらもアクセス制御の方式（unlisted か private か）を変えても解決しない、システムの外側の問題だから。

1. **検索エンジンには残る**——すでにインデックスされたページは、unlisted 化しても自動では消えない。Private（読者認証）にしても、検索結果の項目自体はGoogle側の再クロール待ちか、Search Console での削除申請でしか消せない——アクセス制御とは独立した別作業。しかも Private を作るには読者認証・招待リスト管理という今のブログにない仕組み一式が要り（現状は管理者ログインのみ、読者向け認証機能は構想止まりで未着手）、この懸念のためだけに実装する投資ではない。
2. **既存のRSS購読者には残る**——配信済みのフィードアイテムは購読者のリーダーにローカルで残り、サーバー側の設定変更では回収できない。RSS という仕組み自体に配信済みアイテムを取り消す手段がない。

**参考**: YouTube の「限定公開」も同型の設計（不透明なURL＋自サイト内検索から除外、認証なし）だが、限定公開URLが外部ページに貼られると、そのページをGoogleがクロールして検索に出てしまうことがあると公式ヘルプが明記している（`support.google.com/youtube/answer/9230970`）。YouTube は2021年、2017年以前の限定公開動画を一括で強制 Private 化するセキュリティアップデートまで行っており、「不透明URL＋非掲載」だけに頼る手法は年月とともに実質的な秘匿性が劣化しうることの実例——ただし YouTube 規模の話で、個人ブログでそこまでの対策（経年での強制切り替えなど）を用意する必要はないと判断する。

## 10. 実装メモ（2026-09-06）

- **スキーマ**: `lib/db/schema.ts` の `unlisted` 列は `drizzle/0006_stormy_crystal.sql`（`ALTER TABLE posts ADD unlisted integer DEFAULT false NOT NULL;`）で追加し、本番 DB に適用済み。§11 の廃止後も残っている。
- **クエリ**: `lib/posts.ts` の `getAllPosts`・`getPostsByCategory` が `eq(posts.unlisted, false)` で絞る。`toPost` は `unlisted` を読み、`Post` に載せる（`PostFrontmatter` には無く、したがって `DraftContent` にも無い）。
- **テスト**: `lib/posts.test.ts` が一覧からの除外・直接 URL アクセス・管理画面での可視性を、列に直接書いた行で測る。廃止後もフィルタが生きている証拠として残してある。
- **未変更（意図的）**: `getPostBySlug`・`listAllPosts`・`app/api/posts/search/route.ts` は §4 の設計どおり無変更。

## 11. UI の廃止（2026-09-21）

**決定**: エディタのチェックボックス、ヘッダのチップ（タッチではロックアイコン）、管理画面のバッジを外し、保存経路からもフィールドを外した。列と一覧のフィルタは残す。

**理由**: 用途が無かった。本書は仕組みを書いているが「誰に何を見せたいか」を持たず、廃止時点で限定公開の記事は 0 件だった。自分で確かめる用途は下書きプレビューが受ける。他人にレビューを頼む用途には向かない — 限定公開も「公開」なので初回公開で公開日が確定し（`lib/posts-write.ts` の `date`）、本公開したときの日付がレビュー開始日になる。

**前提**: 限定公開の行が 0 件であること。保存経路がフィールドを運ばないので、仮に `unlisted = 1` の行があっても次の公開で変わりはしないが、著者からはその状態が見えず、戻す手段も無い。

**復活の条件**: 読者認証（Google アカウント等）が入ったとき。そのとき作るのは「許可した人だけが読める」機能で、いまの「URL を知っていれば誰でも読める」とは別物である。流用できるのは一覧・RSS からの除外（§4 のフィルタ）だけで、記事ページでの閲覧者確認・許可の管理・OGP（クローラはログインできない）は新規になる。**`unlisted` 列は使い回さない** — 同じ列に 2 つの意味を持たせると、古い行がどちらの意味で書かれたか区別できない。`visibility`（公開／URL のみ／認証必須）のような列に置き換える。

**引き継ぐ知見**: 記事の設定の中で controlled なチェックボックスを使うなら、server action の後に `key` で再マウントすること。React 19 は action が終わるとフォームを reset し、controlled な checkbox は `defaultChecked` が false のままなので外れる。React の state は true のままで、描画する `checked` が変わらないため DOM に書き戻されず、`new FormData(form)` から値が消える（実測 2026-09-13、限定公開を付けた直後の 更新 で。この間に Ctrl/⌘+S を押すと作業コピーが公開扱いで保存された）。text input は React が既定値を追従させるので影響を受けない。廃止前は `PostEditor.tsx` の `formResetNonce` がこれを担っていた。

---

# 画像キャプション

状態: **実装済み**（2026-09-08）。見た目は note に倣い、記法は Zenn 方式ではなく 2 段落形（§2）。
作成: 2026-09-08。冒頭の編集メモの 3 機能とは別に、同じ流儀でこのファイルに足した 4 件目。

## 1. 実測（2026-09-08）

計測は Qiita が API（`/api/v2/items/<id>` の `body` と `rendered_body`）、Zenn と note は standalone Playwright + system Chrome で実ページから計算値と宣言の両方を取った。ローカルにマークアップを複製する方法は取っていない（2026-09-07 の note 計測がそれで無効になった前例による）。

|       | 記法                                       | DOM                                | 計算値                                                                   |
| ----- | ------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------ |
| Zenn  | 画像の**直後の行**に `*キャプション*`      | `p > img.md-img + br + em`         | block / 14.72px / `rgb(101,113,123)` / 中央 / 斜体 / `margin-top: -16px` |
| Qiita | **無い**（alt と `"タイトル"` のみ）       | `p > a > img`（figure 0）          | —（`title=` 属性＝ツールチップ止まり）                                   |
| note  | 無い（エディタの「キャプションを入力」欄） | `figure > a > img` ＋ `figcaption` | block / 14px / `rgb(8,19,26)` / 中央 / `margin-top: 16px`                |

**Zenn は figure を使わず、CSS 3 行で成立している。**

```css
.znc img.md-img {
  background: var(--c-bg-image);
  max-width: 100%;
  height: auto;
  margin: 1.5rem auto;
  display: table;
}
.znc img.md-img + br {
  display: none;
}
.znc img.md-img ~ em {
  text-align: center;
  color: var(--c-text-subtle);
  margin: -1rem auto 0;
  font-size: 0.92em;
  line-height: 1.3;
  display: block;
}
```

画像とキャプションは同じ段落にいる（ソフト改行の `<br>` を 2 行目が消し、3 行目の負のマージンが詰める）。空行を挟むと別の `<p>` になりセレクタが当たらないので、「直後の行」は必須条件である。

**誤爆は理屈の上では起きるが、実測では観測されなかった。** `~` は「同じ段落で画像より後にある直接の子の em」に当たる（リンクや `strong` の中の入れ子は当たらない）。**2 つのサンプルは母集団が同一ではない** — Zenn の一覧ページは走るたび並びが変わる。

- サンプル A（30 記事 / 画像を含む 87 段落）: em を持つ 45 段落はすべてキャプション。**誤爆 0**。
- サンプル B（20 記事 / 画像 71 枚）: 画像の直後の行に普通の本文があるもの **6 枚（約 8%）**、キャプション 41 枚。`*` が一つ入れば中央寄せの灰色ブロックになる位置がそれだけある。

**Qiita に機構が無いことは 3 通りで確認した。** 公式チートシート（`c686397e4a0f4f11683d`）が画像について書いているのは alt と `"画像タイトル"` だけ、`rendered_body` に figure/figcaption が 0、記事用スタイルシート（`article-….min.css`、129,430 bytes）に `figcaption`・`figure`・`img +`/`img ~` のセレクタが 1 本も無い（本文の em は `.it-MdContent em{font-style:italic}` のみ）。決め手は **Zenn 形を実際に書いている Qiita 記事**で（新着 300 件中 2 件、例 `3462601af43b4118498e`）、renderer が出す HTML は `<a><img></a><br>\n<em>…</em></p>` と **Zenn と同じ形**なのに、当てる CSS が無いので本文と同じ大きさの斜体 1 行として描かれる。記法は壊れず、ただ効かない。

**note で目を引いたのは 2 点。** キャプションの色が `rgb(8,19,26)` で**本文と同色**（Zenn のように薄くしない）こと、引用にもキャプションが付きそちらは右寄せになること（`blockquote + figcaption{text-align:right}`、出典の位置）。著者が未入力でも空の `figcaption` が DOM に残る。サンプルは `note.com/tohoku_itako_661/n/n40a21b27eea9` と `note.com/info/n/n611d3e257e54`。

## 2. 記法は 2 段落形（Zenn 方式ではない）

**決定**: キャプションは**画像の次の段落**に `*キャプション*` と書く。空行を挟む、ふつうの段落である。Zenn の「直後の行（＝同じ段落）」は採らない。

**理由**: 書ける形がこれだけだからで、しかもこちらのほうが安全だから。エディタの画像は block ノードで、その直列化が `closeBlock` する（`components/editor/image-extension.ts` の `serializeImage`）ので、著者が作れる markdown は必ず空行入りになる。実測（2026-09-08、実エディタで往復）: 画像の下で Ctrl+I → 入力 → 保存 → リロードで `![cap](/uploads/….png)\n\n*キャプション*` がそのまま戻る。**エディタ側の記法の追加は 0 で、今日書ける操作がそのまま記法になっている。**

安全な理由は条件の強さである。同じ段落形を CSS で拾うなら一般兄弟セレクタしか手が無く、それは「画像より後のどこかの強調」しか言えない（Zenn の `~`。§1 のとおり、サンプル 71 枚中 6 枚が `*` 一つで巻き込まれる位置にある）。2 段落形なら **「強調がその段落の唯一の子であること」**を条件にできる。これは CSS では書けず hast では書けるので、描画側で組み替える形になる。

**機構**:

- 公開側は `lib/rehype-image-caption.ts`。`<p>` の唯一の子が `<img>` で、次の要素兄弟が「唯一の子が `<em>` の `<p>`」のとき、2 つを `<figure class="image-figure">` ＋ `<figcaption>` に畳む。**sanitize の後段**に置く — `defaultSchema` の `tagNames` は `figure` も `figcaption` も持たないので、前段で作れば剥がされる（`rehype-pretty-code` と `rehypeLinkCard` が同じ位置に居るのと同じ理由）。`<em>` は畳むときに外す: 強調は「この行はキャプションだ」という記法であって斜体の要求ではなく、決めた見た目（note）は正体だからである。
- エディタ側は `components/editor/image-caption-extension.ts`。同じ段落に `image-caption` クラスの `Decoration.node` を置くだけの、`thumbnail-highlight-extension.ts` と同じ形。**これは装飾ではなく約束の履行である** — `docs/link-card-requirements.md` §22.1 が「エディタと公開後で絵の見え方を一致させる」と決めており、キャプションはその絵の一部だから。
- **2 つの規則は別の材料に対して書かれている**（公開側は hast、エディタ側は ProseMirror ドキュメント）ので、対応は明示的に測る。エディタ側の条件は「段落の子がすべて italic マークを持つテキスト」で、これが「唯一の子が `<em>`」に対応する: `*a* *b*` は間の空白が無標なので両側とも不成立、`*a **b***` は両方の子が italic を保つので両側とも成立する。`e2e/image-caption.spec.ts` がこの対応そのものを測る。
- 見た目は `app/globals.css`（`.image-figure > figcaption` と `p.image-caption` に同じ宣言）。中央・`0.875em`・`color: inherit`。**色を `inherit` にしているのが note との一致点**で、Zenn は薄い灰色に落とすが note は本文と同色のまま出す（§1 の実測）。リテラルを書かないので、ダーク側の対応も要らない。エディタ側だけは `.prose em` の skew を打ち消す（記法として残っている `<em>` が公開側には無いため）。
- **空のキャプションも中央に置く。** 空の段落は公開側の規則ではキャプションではない（保存すると何も残らない）ので印の対象外だが、それだけだと**キャレットが左端に出て、最初の 1 文字で中央へ飛ぶ**。エディタ側だけ「空・直前が画像・キャレットがそこ・italic が pending」を追加の条件にしてある（`isPendingCaption`）。italic が pending であることを要求するので、ただ空行に降りただけの段落は掴まない。
- **空のキャプションは文言で名乗る**（`キャプションを入力`、note と同じ文言）。押した結果が中央へ動いたキャレットだけでは、ボタンが効いたことも行の意味も画面に出ない — コードブロックのファイル名欄が「枠のないキャプションとして描かれる控えには、文言以外に自分を名乗る手段が無い」という同じ理由で `ファイル名を追加` を出している。**空は属性で伝える**（`data-empty`）: 空の ProseMirror textblock は末尾に `<br>` を持つので `:empty` が一致しない（`footnote-extension.ts` が同じ理由で同じ手を使う）。**描き方はアコーディオンのタイトルの `float: left` ではなく `display: block; height: 0`** — float は左寄せの行でキャレットを 0 の位置に留めるためのもので、中央寄せのこの行では文言だけが隅に落ちる。高さ 0 は行ボックスを伸ばさないので、キャレットは空行の位置から動かない（外すと行が 22.4px → 44.8px になる。実測 2026-09-08）。
- **絵とキャプションの間隔は 8px で、2 面で作りが違うので実測で合わせてある。** 公開側は figure が外側の 2em を持ち（キャプションの有無で絵の位置が動かないよう、無印の画像が既に持っている 2em に合わせた）、中の `<img>` の margin を 0 にして、間隔はキャプション自身の `0.5rem` になる。エディタ側は typography の `img { margin-bottom: 2em }` が `.image-box`/`.image-block`（padding も border も無い）を抜けて collapse し、キャプションの margin に勝つので、**32px 対 8px でずれる**。閉じるのはキャプション側の負のマージンで、collapse の結果は `max(正) + min(負)` だから `calc(0.5rem - 2rem)` がちょうど 8px を残す。**`em` ではなく `rem`** — 絵の 2em は本文の 16px に対して解決するのに、この段落自身の font-size は 0.875em なので、`em` で書くと引く量が 4px 足りず間隔が広く残る（実測 2026-09-08）。絵の側に decoration を置いて margin を 0 にする形でも同じ結果になるが、規則 1 本で足りるほうを採った。`e2e/image-caption.spec.ts` が両面の実寸を突き合わせ、8px であることも測る — **2 つの矩形は 1 回の `evaluate` で読む**。2 回の `boundingBox()` はラウンドトリップが 2 回で、その間にオートセーブの状態行が1 行ぶん伸びると 2 つ目だけがずれた版面で測られ、間隔が 8px 広く出る（実測 2026-09-08）。
- **入れ子の中でも成立する。** 引用や囲み枠は `block+` なので絵とキャプションが入る（`useImageUpload` が拒むのは表のセルとコードブロックだけ）。公開側は木を全部歩くので自然に効き、`lib/render.test.ts` が引用の中で測る。エディタ側も同じ理由で段落以外に降りる作りにしてあるが、**入れ子の中の印そのものは未実測**（E2E で囲み枠に絵を入れる手数に見合わないと判断した）。

**入り口はバブルメニューの「キャプション」**（`ImageBubble.tsx`）。記法だけでも書けるが、それは規約を知っている著者にしか届かない — Zenn も入り口を持たないが、こちらは WYSIWYG で、見た目を借りた note にはエディタに専用の欄がある。押すと画像の直後の段落にキャレットを置き、italic を効かせる。既にキャプションがあればその末尾に入る（作り直さない）。**空の段落は作らずに使い回す** — TrailingNode が文書末尾に必ず 1 つ置くので、最後の画像で押すとキャプションの居場所には空段落が既にあることがほとんどで、そこへ挿入すると空行が 1 つ残る。

- **文言は 6 文字**。トグルの 8 文字より短いので、メニューの幅を決めるのはこのボタンではない。短い候補 2 つはどちらも他に取られている — 注釈は脚注（`footnote-literal-extension.ts`）に読め、説明は alt を編集する UI が名乗るべき語である。
- `setItalic` であって `toggleItalic` ではない。ガード付きのトグルは accentEmphasis の排他のためにあり（`guarded-toggle-marks.ts`）、ここでやりたいのはマークを立てることであって反転ではない — 2 度押してもキャプションのままでなければならない。
- focus は `scrollIntoView: false`（§22 のトグルと同じ理由）。位置を渡すので `delayedFocus` の枝には入らないが、運ぶ先が無いのは同じである。

**却下: 画像ノードを NodeView 化してキャプション属性を持たせる案。** 保存形式（`![alt](src)`）に置き場所が無く、`title` に押し込めば他所で誰もキャプションとして描かない。2 段落形なら保存も操作も既存のままで済む。

## 3. 受け入れ基準

| ID  | 基準                                                                                                         | 測り方                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | 画像＋強調だけの段落が figure/figcaption になり、`<em>` は残らない                                           | `lib/render.test.ts`                                                                                                                                                                                                                                                                                                                    |
| 1b  | ふつうの本文、強調＋他の文字、強調 2 つ、画像以外の直後は畳まれない                                          | 同上（4 本）                                                                                                                                                                                                                                                                                                                            |
| 1c  | 強調が入れ子の markup を包む場合は畳まれ、中身が残る                                                         | 同上（`*a **b***`）                                                                                                                                                                                                                                                                                                                     |
| 1d  | 手書きの `<figure>` は sanitize に落ちる（後段で作る形が保たれている）                                       | 同上                                                                                                                                                                                                                                                                                                                                    |
| 1e  | エディタが同じ段落に印を付け、中央・正体で描く                                                               | `e2e/image-caption.spec.ts`                                                                                                                                                                                                                                                                                                             |
| 1f  | エディタは本文・強調＋他の文字には印を付けない                                                               | 同上                                                                                                                                                                                                                                                                                                                                    |
| 1g  | 公開ページのキャプションが**本文と同色**で、本文より小さい                                                   | 同上（`color: inherit` を外すと赤。実測: 灰 `lab(47.9 …)` 対 本文 `lab(26.8 …)`）                                                                                                                                                                                                                                                       |
| 1h  | 絵とキャプションの間隔が 2 面とも 8px で一致する                                                             | 同上（両面の実寸を 1 回の `evaluate` で突き合わせる。キャプションの負のマージンを外すと 32px 対 8px で赤）                                                                                                                                                                                                                              |
| 1i  | 引用の中の画像でもキャプションが成立する                                                                     | `lib/render.test.ts`（エディタ側の入れ子は未実測、§2 参照）                                                                                                                                                                                                                                                                             |
| 1j  | バブルメニューの「キャプション」がキャプションを開き（空でも中央）、2 度目は同じものに戻る（段落は増えない） | `e2e/image-caption.spec.ts`（**2 度目の前に別の場所を押す** — prosemirror-view の `handlers.mousedown` は `now - view.input.lastClick.time < 500 && isNear(...)` を満たす押下をダブルクリックとして扱い、ポータルされたボタンの押下は `view.dom` に届かないので `lastClick` は 1 度目のまま残る。位置で外すほうが時間で待つより決定的） |
| 1k  | 空のキャプションに `キャプションを入力` が出て、行の高さを変えず、入力すると消える                           | `e2e/image-caption.spec.ts`（`::before` の `content` と行の実寸を測る。`height: 0` を外すと 22.4px → 44.8px で赤）                                                                                                                                                                                                                      |

---

# 画像の拡大

状態: **実装済み**（2026-09-08。`components/ImageZoom.tsx`、`app/globals.css`、`components/PostArticle.tsx`）
作成: 2026-09-08。本文画像の一連（キャプション・alt）と同じ流れで、このファイルに足した 5 件目。

## 1. 決定

**公開ページの本文画像をクリックすると、ウィンドウいっぱいに開く。** カーソルは `zoom-in` を**無条件に**出す — 列がその絵を縮小しているかどうかは見ない。

**理由**: note がそうしている（`.note-common-styles__textnote-body img.is-slide{cursor:zoom-in}` という静的な規則。実測 2026-09-08）。測って出し分ける案も検討した — こちらの実アップロード 5 枚のうち 4 枚は列幅 750px 以下で拡大の余地が無く、無条件だと空振りが既定になるため。ただし「余地」はビューポート幅で変わるので、判定はクライアントで測り直し続ける必要があり、カーソルがリサイズで現れたり消えたりする。**空振りするカーソルより、状態が揺れないカーソルを採った。** note が空振りしないのは配信側で列幅の 2 倍を用意しているからで（実測: `naturalWidth 1200 / 表示 620`、`?width=2000&fit=bounds`）、そこを揃えるのは別の作業である。

## 2. 機構

- `components/ImageZoom.tsx` は `CodeCopyButtons` / `FootnotePopover` / `EmbedFrames` と同じ形の注入型クライアントコンポーネントで、`#post-body` に委譲クリックを 1 つ張るだけ。本文は `dangerouslySetInnerHTML` のまま、公開パイプラインにも sanitize にも触らない。
- **対象は著者の画像だけ**（`img` でクラスを持たないもの）。この site がクロムとして描く絵は必ずクラスを持ち、著者の絵は持ち得ない（`rehype-sanitize` が `img` に `className` を通さない）ため、`.prose img:not([class])` と同じ判定で足りる。`<a>` の中の画像は対象外 — クリックはリンクのものである。
- **スコープは `#post-body` であって `.prose` ではない。** `.prose` はエディタと公開ページの共有で、編集面のクリックは NodeSelection（バブルメニュー）に割り当て済みなので、そこに `zoom-in` を出すのは嘘になる。CSS もリスナも公開側の container に閉じてある。
- **土台は modal な `<dialog>`**（`showModal()`）。Escape・`::backdrop`・フォーカストラップ・背後の inert がブラウザ側で付く。`popover="manual"` はそのどれも付かず全部自前になる（`docs/editor-pitfalls.md` §17.1）。UA の `dialog` の箱（中央寄せ・枠・`max-width: calc(100% - 6px - 2em)`）は打ち消して、**要素自体をビューポートにする** — これが「背景クリック＝ dialog 自身へのクリック」を成立させる。`::backdrop` は疑似要素なのでクリック対象にならない。
- **虫眼鏡は絵の上に出す**（`zoom-out`）。拡大されたのは絵なので、戻す申し出をするのも絵である。**そしてクリックで実際に閉じる** — カーソルが約束したことを画面が守らないのは、エディタに `zoom-in` を出さない理由と同じ形の嘘になる。周囲は素の矢印のままで、そこを押しても閉じる（背景を押して閉じるのは説明の要らない慣習）。キャプションだけは対象外 — 文字なので、押すのは選択したい人である。
- **背後のページはホイールでも動かさない。** `showModal()` が inert にするのはクリックとフォーカスで、**ホイールは対象外**である（記事が絵の下でスクロールした）。`html:has(dialog.image-zoom[open])` に `overflow: hidden` を当てて塞ぐ。`html` は既に `scrollbar-gutter: stable` を持っているので、スクロールバーが消えることによる横方向のずれは起きない。
- **背景はページ自身の地を透かしたもの**で、黒でも白でもない。実測 2026-09-08（配色スキームを切り替えて再測）: note は `.pswp__bg` を body と同じ色・`opacity: .9`（255,255,255 / 32,42,48）、Zenn は容器を 80% で透かして `blur(2px)`（255,255,255 / 8,29,53）。**Zenn の形をそのまま採った**（`color-mix(in srgb, var(--background) 80%, transparent)` ＋ 2px）。**塗るのは `::backdrop` ではなく dialog 自身** — dialog は既にビューポート全面で、`::backdrop` が originating element から custom property を継承するかはエンジンのバージョン依存なので、`var(--background)` を当てにできない。
- **上に載るクロムもテーマに従う。** キャプションと閉じるボタンは当初「黒い覆いの上」を前提に固定の明色で書いていたが、背景が地の色になった瞬間にライトで白地に白文字になる。どちらも `--foreground` に寄せてある。
- **閉じるボタンを右上に置く**（note と同じ位置。実測 2026-09-08: PhotoSwipe の 40×40）。**dialog の最初の子にしてあるのが肝**で、`showModal()` は最初のフォーカス可能な子にフォーカスを移すが、絵と段落しか無いと dialog 自身に落ち、画面上に出口を示すものが何も無くなる。Escape は効くが不可視、絵と背景はポインタ前提である。**送りボタン（前後の画像）は入れない** — note のそれは PhotoSwipe をそのまま使っている結果で、記事あたり画像 1 枚が実態のここでは空振りの UI になる。
- **閉じ方は 4 つ**: Escape、背景クリック、ブラウザの「戻る」。戻るのために開くとき `history.pushState` し、**他の経路で閉じたら `history.back()` でその 1 件を戻す** — でないと読者の次の「戻る」が何も起きないように見える。
- **自分で起こした popstate は無視する**（`ownPop`）。`history.back()` は非同期で、閉じてすぐ別の絵を開くと、その popstate が**開いたばかりの dialog を閉じていた**（実測 2026-09-08、E2E で検出）。
- **キャプションは一緒に運ぶ**。`figure.image-figure > figcaption` の文字列を拡大側にも出し、`aria-label` にも使う。アップロードした画像は alt を持たない（`useImageUpload.ts`）ので、名前になる文字列が他に無い。キャプションが無ければ「画像」に落とす。
- **開くとき、開いている popover を閉じる**。脚注のプレビューは top layer に居るので、そのままだと絵の上に残る。`[popover]` 全部に `hidePopover()` を試す形にして、`FootnotePopover` の作りには依存しない。
- **アニメーションは付けない。** 開閉は 1 フレームで切り替わる。Zenn と note はどちらも絵を 333ms かけて拡大する（実測 2026-09-08、`.pswp__zoom-wrap` の `transform 0.333s cubic-bezier(0.4, 0, 0.22, 1)`）が、ここでは著者の判断で採らない — 実装を 2 度試みてどちらも不具合を出した（1 度目は「note はフェードだけ」という誤測に基づくもので、計測対象を内側の `<img>` に取り違えていた。2 度目は CSS の差し替えで `[open]` の `display` 規則を巻き込んで消し、覆いの色を遷移させたせいでテストが遷移途中の値を読んだ）。**遷移を足すなら、`display` と `overlay` を discrete として一緒に動かすこと**（modal dialog は閉じた瞬間に top layer を出るので、無いと閉じる向きが 1 フレームで消える）と、**色や寸法を測るテストは落ち着いた値を待つこと**が前提になる。
- **拡大は 1 段階**（`object-fit: contain` で全体を収める）。パンやピンチは入れない — 保存形式が `![](src)` で寸法を持たず、ジェスチャ層は別機能である。

## 3. 受け入れ基準

| ID  | 基準                                                                                                | 測り方                                                                                                |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2a  | 本文画像に `zoom-in` が出て、クリックで modal な dialog が開く                                      | `e2e/image-zoom.spec.ts`（`:modal` で測る）                                                           |
| 2b  | キャプションが拡大側にも出て、dialog の名前になる                                                   | 同上                                                                                                  |
| 2c  | キャプションが無い画像は名前が「画像」で、説明行は出ない                                            | 同上                                                                                                  |
| 2d  | 閉じるボタン・絵のクリック・Escape・背景クリック・戻るのどれでも閉じ、閉じたあとも記事の URL に居る | 同上（`pushState` を外すと、戻るで記事から出てしまい赤）                                              |
| 2f  | 拡大中はホイールで記事がスクロールしない                                                            | 同上（閉じたあと同じ操作でスクロールすることを対照に測る。`overflow: hidden` を外すと 51px 動いて赤） |
| 2g  | 閉じるボタンが開いた時点でフォーカスを持ち、押すと閉じる（閉じた直後に別の絵を開いても閉じない）    | 同上（`ownPop` を外すと、再度開いた dialog が自分の `history.back()` の popstate で閉じて赤）         |
| 2h  | 背景がライト／ダークそれぞれでページの地の色に従い、80% で透け、2px ぼける                          | 同上（色リテラルではなく「ページと同じ 3 チャンネル」で測る。固定色に戻すと両方で赤）                 |
| 2e  | エディタには `zoom-in` も dialog も無く、クリックは今までどおり画像を選ぶ                           | 同上（`.prose` にスコープを広げると赤）                                                               |

---

# E2E: 3シャードは開発サーバと同居できない

状態: **実測 2026-09-12**（機能ではなく、このリポジトリで測れた運用上の事実。`docs/` に単独のハーネス文書が無いため、記録をまとめてあるこのファイルに置く）

`npm run test:e2e:shards` は既定で 3 プロセスを立てる（`scripts/e2e-shards.mts`）。各シャードが `next dev` と Chrome を 1 つずつ持つので、**`npm run dev` を動かしたまま走らせるとメモリが足りなくなる**。

実測（19GB のマシン）: 開発サーバありで 764 件中 61 件が赤、2,070 秒。続けて同じ実行をかけると OS にメモリ不足で強制終了された。開発サーバを止めると 764 件すべて緑、925 秒。

**赤の出方が診断になる。** 61 件は 17 ファイルにまたがっていたが、落ちた場所は全件同じで、`投稿` を押したあと公開完了を待つ 20 秒——スイート中で最も長い待ち——だった（当時の待機条件は文字列 `公開済み（最新）`。2026-09-13 にこの表示を廃止し、待機条件は `e2e/editor-authoring.ts` の `expectPublished`——`data-publish-state="published-current"` ——に移した）。同じファイルを直列で流すと全部通る。つまり**失敗が 1 種類のタイムアウトに集中し、実行時間が倍近い**ときは、コードではなくメモリを先に見る（`free -m`、`pgrep -f "next dev"`）。

**そして、ここから疑うより先に「1 本で走らせて同じか」を見る。** 2026-09-12 に `image-bubble-position.spec.ts` の 22s（メニューを絵の角に収める）が全件で 1 件だけ赤くなり、キャッシュのせい・直前の変更のせいと 2 度続けて誤診した。実際は**このスペックがファイル内の実行順に依存している** — 単体で走らせると変更の有無にかかわらず、`HEAD` でも赤い。ファイルごと走らせると 7 件すべて緑になる。**同じコミット・同じビルドで、走らせるテストの集合だけを変えて確かめたのが決め手**だった。原因は `data/uploads` だった — 先行するテストが同じ絵を上げ終えていると `<img>` が最初のフレームから寸法を持ち、そうでなければ 0×0 のまま。**22s 側は製品の欠陥として直したので、いまは単体でも緑である**（`components/editor/ImageBubble.tsx`）。

**件数を待つのは、新しい結果を待つことではない。** 同じ日に `editor-link-card.spec.ts` の 20b/20c が全件で落ちた。検索欄に 2 つのクエリを続けて入れ、どちらもちょうど 1 件を返す作りで、間に置かれた待ちが `toHaveCount(1)` だった — **前のクエリの 1 件が残ったままでも成立する**ので、下書きの行を公開済み記事として読み、バッジが `未公開` で落ちる。2 つ目のクエリが届いたかどうかに依存するため間欠で、単体実行でも全件でも出る（「ファイル順に依存している」と一度書いたが、それは 2 回の観測から早合点したもので誤り）。前の行が消えるのを待つように直した — 修正後 15 回連続緑、修正前はループ 1 回目で赤。

---

# 書き方ヘルプ（設計のみ）

状態: **設計のみ** — 2026-09-20 の相談で設計まで進めてある。未着手
作成: 2026-09-20、着手前に書いている（このファイルの他の記録と同じ流儀）
関連: `docs/editor-requirements.md` §12.4/§12.5（ポインタとタッチの出し分け idiom）、`docs/link-requirements.md` §8（`Mod-k` の受け入れ基準 4f/4g/4r）

## 1. 目的と決定

note がキーボードショートカットのドロワーを持っている、というところから始まった相談である。

**採らない案**: ショートカットの一覧。**採る案**: 入力規則・スラッシュコマンド・ショートカットを 1 枚に並べた「書き方」ヘルプ。

**理由**: ツールチップは `hover: none` では存在しない（`app/globals.css` の該当規則）。つまりツールバーの鍵が読めるのはポインタの面だけで、ポインタの面では既に読める——この相談はデスクトップのみを対象としているので、一覧はその重複になる。未露出なのは別の 3 つである: markdown の入力規則、スラッシュメニュー、そしてツールバーにボタンを持たない `Mod-k`（`LinkBubble.tsx`。ツールバーの「リンク」は `openInsertDialog` という別コマンドで `shortcut` を持たない）。

## 2. 置き場: ヘッダ右端の `?`、ポインタのみ

ツールバーは「コマンドの面」、ヘッダは「この記事について・周辺機能の面」であり、ヘルプは後者に属する。タッチには鍵が無く、`+` ドロワーで既に幅を使い切っているので、出し分けは §12.4 の idiom（DOM に両方、`hover` が描く側を決める）ではなく `pointer-only` 側だけの単独配置でよい。

ヘルプ自身のショートカット（`Mod-/` など）は**付けない**。キーマップはブラウザでしか測れず、開くための利便に spec が 1 本増える。

## 3. モーダルの機構

`components/editor/WritingHelpDialog.tsx` を新しく作る。`InsertDialog` を拡張はしない——共有できるのは器であって、中身も開く条件も別物だからである。借りるのは次の 4 つで、いずれも `InsertDialog.tsx` に前例がある。

- `role='dialog'` + `aria-modal='true'`
- Escape で閉じ、そのキーイベントは `stopPropagation` する（エディタ自身の Escape 処理を走らせない）
- 背景クリックで閉じる
- `useBodyScrollLock`

`?` は「エディタの外のコントロール」なので、開くとリンクカードは消える（`docs/link-requirements.md` §8 の 5b/5c/5d が固定しているフォーカス基準の規則。ツールバーのボタンだけが例外である）。入力途中で未適用の URL も一緒に消える（同 5e）。既存の挙動どおりであり、**新しい基準行は足さない**——ここに書くのは、将来これを退行として読まないためである。

**閉じたときフォーカスは `?` ボタンへ戻す。** エディタへは戻さない——`chain().focus()` はスクロールを伴う（`docs/editor-pitfalls.md` §13.4）。

**画面に出る文言は「ヘルプ」**（2026-09-20。`書き方` は見出しとして硬く、`キーヘルプ` は鍵しか載っていないと言ってしまう——記法の表がいちばん大きい）。この記録と、コード中の引用は機能名として「書き方ヘルプ」のままで、`WritingHelpDialog.tsx` というファイル名も変えていない。

位置は 記事の設定 の左、`toolbar-button` を着せたアイコンボタンで `aria-label` は「書き方」。記法の表はコンポーネント内のリテラルに置く（§5 のとおり手で保つ層なので、テストから参照する理由が無い）。本文の表記は既定の方針どおり、ラテン語の前後に空白を入れる（`この URL は`）。

## 4. 中身

1 スクロール・3 セクション。タブは付けない（探しているものが隠れる）、検索欄も付けない（それはスラッシュメニューの仕事である）、行から挿入できるようにもしない（第二のコマンド面になる）。並びは未発見度の高い順で、ツールチップに既に出ているショートカットが最後に来る。

### 4.1 記法

| 打つもの                                  | なるもの                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `## ` / `### `                            | 大見出し / 小見出し（**見出しは 2 階層のみ**）。`Heading.configure({ levels: [2, 3] })`。閉じた集合だと言い切ることが要点で、`# ` は黙って効かない |
| `- ` / `1. `                              | 箇条書き / 番号付き                                                                                                                                |
| `> `                                      | 引用                                                                                                                                               |
| `:::info ` / `:::warning ` / `:::danger ` | 囲み枠（情報 / 注意 / 警告）。トップレベルのみ                                                                                                     |
| `:::details `                             | アコーディオン                                                                                                                                     |
| ` ``` ` / ` ```ts ` / ` ```ts:file.ts `   | コードブロック                                                                                                                                     |
| `---`                                     | 区切り線                                                                                                                                           |
| `[text](url)`                             | リンク                                                                                                                                             |
| `[^`                                      | 脚注                                                                                                                                               |

**`**太字**`/`*斜体*`/`~~打ち消し~~` は載せない**（2026-09-20）。3 つともツールバーにボタンがあり、鍵も §4.3 に出ているので、記法の行が足す能力は無い。**インラインコードだけは残す** —— ボタンが無く、落とすと製品に残る痕跡が §4.3 の 1 行だけになるうえ、そちらは折り返しの下にある。`---` は区切り線を作る唯一の手段である（`setHorizontalRule` を呼ぶ導線がツールバーにもスラッシュにも無い）。

**落としたチップが 2 つある**（2026-09-20、シートに合わせて記録もここで揃えた）。`” ```diff_ts ”` は3 つのチップが既に形（素・言語つき・言語＋ファイル名）を伝えており、4 つ目が教えるのは形ではなく diff ハイライトという別機能で、チップ 1 個では伝わらない——載せるなら説明のある別の行にすること。`[text](url "title")` は、**この製品に link title を見せる場所も編集する場所も無い**から落とした（リンクカードは URL だけを編集し、title は壊さず保つだけ——`docs/link-requirements.md` §8 の 4c）。

**`**太字**` `*斜体*` `~~打ち消し~~` `` `コード` `` は載せない**（2026-09-20）。4 つとも鍵が §4.3 に出ており（前の 3 つはツールバーのボタンも持つ）、記法の行が足す能力は無い——選んでから押すか打ちながら書くかという書き方の違いであって、できることの違いではない。**区切り線だけは残る**: `---` と打つのが唯一の作り方で、`setHorizontalRule` を呼ぶ導線はツールバーにもスラッシュにも無く、鍵も無い。

**`:::` と `[!TYPE]` は 2 系統の語彙で、1 語ずれている** —— `:::warning ` は「注意」、`[!WARNING]` は「警告」を指す（`DIRECTIVE_TYPES`。`:::` 側は info < warning < danger という段階の言葉で、`[!TYPE]` 側は内部の型名かつ保存形式そのもの）。**シートは `:::` しか載せないので、この食い違いは読者に届かない。** `> [!NOTE]` は同じ 3 段に届くが能力を 1 つも足さず、並べた瞬間に矛盾が表に出る——載せない理由はその 2 つである（2026-09-20）。

**左の列は打つ文字そのもの**で、確定に要る末尾のスペースもチップに含める（`## ` `> ` `:::info ` `:::details `）。右の列に「末尾にスペースか Enter」と書き添える形から 2026-09-20 に移した——規約が 1 つで済み、行も短い。コードフェンス（` ``` `）だけは末尾スペース無しのままで、ここは揃っていない。

**入力規則の取り消し（打った直後の `Backspace`）は載せない。** 2026-09-20、一度書いて外した——表そのもので足りており、行を増やすほうが損である。挙動自体は実在する（実測: `Backspace` は打った文字列を残し、`Ctrl+Z` は行ごと空にする）ので、載せるかどうかは正しさではなく分量の判断である。

### 4.2 スラッシュコマンド

`/` で開くこと。**それだけである** —— 行の一覧も、絞り込みの語彙（`/youtube` `/記事` `/折りたたみ`）も、「置けない場所では開かない」（`hasAnyItem`）も書かない。2026-09-20、いずれも一度書いて外した。開けば候補は目の前に出るうえ、6 行のうち 4 種類はツールバーにボタンもあるので、一覧はまだ知らない能力ではなく同じブロックへの二本目の道を並べているだけになる。ヘルプが引き受けるのは、知らないと何も起きない部分——`/` という開き方——だけである。

節そのものは残す。`/` は文字列が何かに変わる操作ではなくメニューを開く操作なので、記法の表に 1 行として畳むと、その行だけ表の意味がずれる。

### 4.3 ショートカット

ツールバーが `shortcut` で出している 13 個（`Mod-b` `Mod-i` `Mod-Shift-s` `Mod-Shift-e` `Mod-Alt-2` `Mod-Alt-3` `Mod-Shift-7` `Mod-Shift-8` `Mod-Shift-b` `Mod-Alt-c` `Mod-Shift-f` `Mod-z` `Mod-Shift-z`）に、**ボタンを持たない 2 つ** —— `Mod-k`（選択範囲をリンクにする）と `Mod-e`（インラインコード。`@tiptap/extension-code` の既定キーマップ `"Mod-e": () => this.editor.commands.toggleCode()` を `guarded-toggle-marks.ts` が `addCommands` だけ上書きして継承しており、`toggleCode` を呼ぶ UI は無い）—— と `Shift-Enter`（改行）を足す。

`Mod-e` は 2026-09-20 に実測で見つけた漏れである。**継承された鍵は、登録した覚えが無い分だけ落ちやすい。** 同じ日に登録キーマップを掃き出してあり、結果はこの節の末尾の表である。catalog はそこから作る。

**表と脚注定義の `Shift-Enter`/`Mod-Enter` は独立した行にしない。** どちらも HardBreak と同じ「改行」で、固有なのはガードのほう（セルをまたがない、定義から出ない）であり、著者から見れば同じキーが同じことをしている。

**キーは 1 つずつ枠に入れ、`+` は枠の外に置く**（2026-09-20）。`<kbd>` は 1 つのキーを表す要素なので、組み合わせを 1 要素に入れると「`Ctrl+Shift+S` という名前のキーがある」と言うことになる。枠が 3 つあれば「3 つ押す」が形で読め、末尾 1 文字しか違わない行（`Ctrl+Shift+S` と `Ctrl+Shift+E`）を走査するときに目が滑らない。

**ただし Mac は 1 枠のまま**（`⌘⇧S`）。Apple の書き方に区切りが無く、`⌘ + ⇧ + S` とは書かないからである。規則は 1 つに保たれている——**枠とは、そのプラットフォームがキーとして書く単位**であり、それを決めているのは `formatShortcut` の joiner そのものである（`shortcutParts` が部品を返し、ツールチップ側は連結したまま使う）。実測 2026-09-20: 3 枠でも行は折り返さない（最も広い組で 128px、2 列グリッドの列幅に収まる）。

`Mod`/`Alt` + `Backspace`/`Delete` も**載せない**。OS 標準の単語・行削除であり、このリポジトリ固有なのは isolating の境界で止まるクランプだけで、それは設計上見えない。

#### 登録キーマップの掃き出し（実測 2026-09-20）

拡張の一覧は `editor.extensionManager.extensions`（65 個）から、鍵は各パッケージの `addKeyboardShortcuts` を grep して突き合わせ、候補は実際に押して確かめた。**次に「他に鍵はあるか」と訊かれたら、測り直す前にこの表を見ること。**

| キー                    | 動き                                                   | 判断                                                                                           |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `Tab` / `Shift-Tab`     | リストのネストと解除、テーブルの次／前のセル           | 生きている。載せない                                                                           |
| `Mod-Alt-0`             | 段落に戻す（`@tiptap/extension-paragraph`）            | 生きている。載せない                                                                           |
| `Mod-y`                 | やり直す（`Mod-Shift-z` の別名。`@tiptap/extensions`） | 生きている。載せない                                                                           |
| `Mod-u` / `Mod-Shift-9` | 下線 / タスクリスト                                    | **登録されていない**。`underline` も `taskList` も拡張一覧に無く、押しても何も起きない         |
| `Mod-B` / `Mod-I`       | 太字・斜体の大文字別名                                 | 同じ鍵。`Mod-B` は blockquote に `Mod-Shift-B` を通すため削除済み（`guarded-toggle-marks.ts`） |

**`Mod-Alt-0` を載せないのは、ツールバーが既に見える形で同じことをしているから。** 見出しのボタンはトグルなので、H2 の上でもう一度押せば段落に戻る。スラッシュの行一覧を外したのと同じ基準である。

**`Tab` を載せないのは、著者が最初に試す鍵だから。** リストで Tab を押すと入れ子になるのは他のエディタでも同じで、規約が強すぎて「効く」と書く価値がほとんど無い。ここでシートの基準が 1 つ増える——**他に知る手段が無く、かつ自分では思いつかない**こと。`Mod-k` と `Mod-e` は両方を満たし、`Tab` は後半を満たさない。`Mod-y` はさらに手前で落ちる（同じ動きに 2 行使うだけである）。

## 5. ドリフト対策

層ごとに手段が違う。同じ device を 3 つに当てはめようとすると、いちばん守りたい層が守れない。

- **ショートカット: 共有の catalog で構造的に潰す**（`components/editor/shortcut-catalog.ts`、2026-09-20 実装）。 ただし **catalog が上位集合で、`Toolbar.tsx` がその部分集合を key で引く**向きに作ること。逆向き（ツールバーの props を集めたものを catalog と呼ぶ）にすると、`Mod-k` のようなボタンを持たない鍵がヘルプから黙って落ちる——それはこのモーダルを作る理由そのものである。共有していればテストは要らない。
  包含の向きは catalog ⊇ ツールバーが引く鍵であって、catalog = 登録済みキーマップ全部ではない——`guarded-toggle-marks.ts` は `Mod-B` を意図的に削っており、著者に見せる鍵と登録されている鍵は元々一致しない。
- **スラッシュ: 何も要らない。** §4.2 で行の一覧を載せないと決めたので、シートが `ITEMS` について言っていることは「`/` で開く」だけであり、ずれようがない。射影をエクスポートする案は 2026-09-20 に不要になった——行の一覧を復活させるなら、その射影も一緒に戻すこと。
- **記法: 手書きのまま置く。** `addInputRules` のハンドラは `$from.depth !== 1` や blockquote マーカーの 3 段ガードと絡んでおり、表に使える形へきれいに射影できない。入力規則そのものは既に E2E が測っている（`editor-codeblock-language.spec.ts`、アコーディオンと脚注の各 spec、`editor-link-markdown-syntax.spec.ts`）ので、**同じ引き金を打ち直す spec は足さない**——ここでのリスクは「規則が壊れる」ではなく「ヘルプが古くなる」で、種類が違う。この層は手で保つと決めて、その宣言を受け入れ基準の行に置く。

## 6. 付随する変更

`ToolbarButton.tsx` から `isMac` と `shortcutParts` / `formatShortcut` をエクスポートして共有する（⌘ と Ctrl の出し分けを 2 か所に書かないため）。`ariaKeyshortcuts` はボタン専用のままで、シートは読み上げ名を持つコントロールではないので要らなかった。ラベルも catalog 側に移したので、ツールバーの `title='太字'` という literal も消えている。

## 7. 受け入れ基準

**3g 以外は実測で守られている**（3g は退役。下記）。`e2e/editor-writing-help.spec.ts` は 6 件で、うち 2 件は故意に壊して赤くなることを確かめてある——フォーカス復帰を外す、`hover: none` の `display: none` を外す。

| ID  | 基準                                                                      | 測り方                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3a  | ヘッダの `?` でモーダルが開き、Escape・背景クリック・閉じるボタンで閉じる | **実装済み** `e2e/editor-writing-help.spec.ts`（4 つの出口を 1 回の遷移で測る）                                                                                                                                                                                                                                                                                                                                  |
| 3b  | 開いて閉じても、本文とキャレットが動かない                                | **実装済み** 同上。**元の文面「Escape がエディタ側まで届かない」は今の製品では測れない**——エディタ側の Escape 消費者は、エディタ自身の DOM に束ねられている（ProseMirror のハンドラ、スラッシュの `onKeyDown`）か、このシートを開く mousedown で既に閉じている（`useDismiss`）かのどちらかで、同時に開く経路が無い。`stopPropagation` は将来の document 級リスナに対する保険として残し、測れる半分をこの行が測る |
| 3c  | 閉じるとフォーカスが `?` ボタンへ戻り、ページがスクロールしない           | **実装済み** 同上（40 段落を読み込んで 600px スクロールしてから測る。フォーカス復帰を外すと赤）                                                                                                                                                                                                                                                                                                                  |
| 3d  | タッチでは `?` が出ない                                                   | **実装済み** 同上（Pixel 7 のエミュレーション。狭いだけのビューポートは `hover: hover` を返すので足りない。`display: none` を外すと赤）                                                                                                                                                                                                                                                                          |
| 3e  | モーダルが catalog の全行を出す（`Mod-k` を含む）                         | **実装済み** 同上（spec が catalog を import して行数と各ラベルを突き合わせ、リンク行の枠が `Ctrl` `K` の 2 つであることまで測る）                                                                                                                                                                                                                                                                               |
| 3f  | ツールバーは catalog 以外の鍵を持たず、catalog に id / token の重複が無い | **実装済み** `components/editor/shortcut-catalog.test.ts`（4 件。`shortcut='…'` の literal が Toolbar.tsx に 1 つも残っていないことを source から測る——props から測ると、増えた literal が見えない）                                                                                                                                                                                                             |
| 3g  | （退役）スラッシュの節の射影が `ITEMS` と一致する                         | **要らなくなった**。§4.2 で行の一覧を載せないと決めた時点で射影する対象が消えた（2026-09-20）。番号は欠番にせず残す——行の一覧を戻すなら、この基準も一緒に戻る                                                                                                                                                                                                                                                    |
| 3h  | 記法の表は手で保つ——自動検証は無い                                        | なし（この行が宣言である）                                                                                                                                                                                                                                                                                                                                                                                       |

---

# 説明文の自動抽出

状態: **実装済み**（2026-09-21。`lib/excerpt.ts`、`components/PostCard.tsx`、`app/(site)/posts/[slug]/page.tsx`、`lib/rss.ts`）
作成: 2026-09-21、記事の設定ドロワーの批評から

## 1. 決定

**記事に説明欄は無い。** 説明が要る面は、すべて本文の書き出しから導いた抜粋を読む。対象は記事一覧のカード本文、`<meta name="description">`、`og:description`、RSS の `<description>`、内部リンクカードの 2 行目の 5 つである。本文に文字のある TL;DR ブロックがあれば、書き出しではなくその文を使う（`docs/summary-requirements.md` §2）。

**理由**: Zenn・Qiita・note はどれも説明欄を持たない。はてなブログは本文の書き出しを説明の代わりに使う。書かれない欄は空のまま 5 つの面を空にする一方、自動抽出なら「書き忘れ」という状態が無くなる。廃止時点の投稿は 3 件で、説明はどれも仮の文だったので、保存済みの値を守る理由は無かった。

一覧のカードには抜粋を出し続ける。はてなと同じ形で、Zenn の一覧（タイトルのみ）には寄せていない。単調に見えるなら、カードから外すのは `PostCard` の 1 行で済む。

## 2. 機構

- `excerptFromBody` は `lib/thumbnail.ts` の `resolveThumbnail` と同じ位置づけで、導出値を 1 か所で決める。値を保存しないので、本文を直せば 5 つの面が一緒に変わる。
- **行ではなく mdast で読む。** 保存済みの本文は経路によって CRLF と LF が混じり、飛ばすべき構造（fence、raw HTML のカードと埋め込み、`<details>`、GitHub alert）は行スキャンが誤るものばかりである。
- 拾うのは**トップレベルの段落だけ**で、見出し・リスト・表・引用（つまり callout）・コード・HTML ブロックは飛ばす。加えて、画像だけの段落とその直下のキャプション、URL だけの段落、コロンで終わる導入文（「サンプル:」）、アコーディオンの中身も飛ばす。エディタは `<details>` と `</details>` をそれぞれ独立した HTML ブロックとして書くので、中身はトップレベルの段落として現れる（`components/editor/details-extension.ts`）。まとめと TL;DR の中身も同じ形で現れるので、開いたまま閉じていない `<div>` を積んで、どちらの中にいるかを判定する。まとめの中身は拾わない（読み終えた人向けの文である）。
- インラインの raw HTML はタグだけを落とし、中の文字は残す（強調の `<span>`）。脚注参照と画像の alt は拾わない。
- 段落は上限（`EXCERPT_MAX_CHARS`、120 字）まで繋ぎ、超えたらコードポイント単位で切って `…` を付ける。改行（ソフトブレークと段落の継ぎ目）は、直前が和文ならそのまま繋ぎ、欧文なら空白 1 つにする。欧文語の前後に置く通常の空白（「React は」）は残す。
- 一覧では記事ごとに本文を 1 回パースする。`firstBodyImage` は同じ経路を理由に木ではなく正規表現を選んでいるが、あちらは「最初の `/uploads/` 参照」という字面で決まる問いで、こちらは構造を知らないと答えられない問いである。キャッシュの無いこのサイトで一覧が数百件になったら、ここを測り直す。
- 地の文が無い本文の抜粋は空で、`generateMetadata` はそのとき `description` を指定しない。サイトの説明がレイアウトから引き継がれる。
- `posts.description` 列は残してあり、もう読み書きしない（`notNull().default('')` なので挿入側は省略できる）。削除はマイグレーションを伴う別の作業である。`draft_content` の JSON に残る古い `description` キーは読まれず、害も無い。

## 3. 受け入れ基準

| ID  | 基準                                                                               | 測り方                                  |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| 3a  | 見出しから始まる本文でも、最初の地の文が抜粋になる                                 | `lib/excerpt.test.ts`                   |
| 3b  | CRLF の本文と LF の本文で同じ抜粋になる                                            | 同上                                    |
| 3c  | fence・リスト・表・引用・callout・カード・埋め込み・アコーディオンの中身を拾わない | 同上                                    |
| 3d  | 画像とそのキャプション、URL だけの段落、コロンで終わる導入文を拾わない             | 同上                                    |
| 3e  | 上限を超えたらコードポイント単位で切り、`…` を付ける                               | 同上                                    |
| 3f  | 内部リンクカードの説明が、対象記事の本文の抜粋になる                               | `e2e/public-link-card.spec.ts`（5c）    |
| 3g  | RSS の `<description>` が抜粋を CDATA で包み、`]]>` で壊れない                     | `lib/rss.test.ts`                       |
| 3h  | 記事の設定に説明欄が無く、自動保存と公開のペイロードに `description` が含まれない  | 型（`DraftContent` にフィールドが無い） |
| 3i  | 文字のある TL;DR があれば、位置にかかわらずその文が抜粋になり、同じ上限で切れる    | `lib/excerpt.test.ts`                   |
| 3j  | 空の TL;DR は書き出しに落ち、まとめの中身は書き出しとして拾わない                  | 同上                                    |

# 投稿日と更新日の表示

## 1. 決定

- **投稿日は最初の公開で一度だけ打刻し、以後変えない。** 再公開・更新・下書きに戻す、のどれでも保つ。規則は `app/actions/posts.ts` の `existing.date || new Date().toISOString()` の一行で、意味は「最初に公開された時刻」であって最後の編集ではない（2026-06-28、`0c59048`）。
- UTC の ISO 時刻で保存し、JST で表示する（`lib/format.ts` が `Asia/Tokyo` に固定。サーバのタイムゾーンに依存せず、深夜の日付ずれを防ぐ）。時刻まで持つので、同じ日の並び順も安定する。
- エディタに日付の入力欄は無い。`''` は一度も公開していない下書きの印で、管理画面の一覧はその行に公開日を出さない。手で日付を前後させる手段は UI から外した。一括取り込みは `scripts/migrate-content.mts` が SQL で `date` を直接書く。
- 公開側の表示は日付だけで、時刻は出さない（`formatPostDate`）。管理画面の一覧は `編集 {経過}` に最終編集を「3 時間前」「2 日前」のような経過で出し（`formatRelativeTime`。30 日を過ぎたら日付）、分までの時刻はカーソルを乗せたときのツールチップに置く。公開済みの行にだけ `公開 {日付}` を添える（2026-10-04）。一覧は作業中の記事を探すために読むので、知りたいのは時刻ではなく「どれくらい前に触ったか」である。「更新」と書かないのは、公開側の更新日とは別の時刻だからである。
- 更新日が投稿日と別の日（JST）になったときだけ更新日を添える（`hasVisibleUpdate`。公開側は `更新: {日付}`）。同じ日の更新では何も足さない。

## 2. 理由

当初（2026-06-28）は公開側に投稿日しか出さなかった。2026-09-06 に更新日の表示を足した。比較の基準にしている Zenn・Qiita・dev.to の 3 社がいずれも、編集が実際に入った記事に別の更新日を出していることを直接確かめたためである。粒度は当初の方針どおり日付だけにしている。

`Post.updatedAt`（`posts.updated_at`、`commitPost` / `createPost` のたびに更新）は `date` と同じくサーバが管理し、`DraftContent` には入れない。

最終編集の時刻は別の列 `posts.edited_at` が持つ（2026-10-04）。作者の書き込みのたびに動く — 作成、下書きの自動保存、公開済みの記事の作業コピーへの自動保存、公開・更新・非公開化、リビジョンの復元。管理画面の一覧はこれの新しい順に並ぶ。公開日の順では、公開日の無い下書きが常に最下段に沈み、公開済みの記事を書き直している途中（未公開の変更）は公開した日の位置から動かなかった。`updated_at` で兼ねないのは、作業コピーへの保存が読者に見える内容を変えず、公開側の更新日を動かしてはいけないためである。タグの辞書の操作は作者の編集ではないので、どちらの列にも触らない。

# 見送り・現状維持の決定

作らないこと・変えないことに決めた事柄の記録。どれも再提案しない。前提が変わったときの条件を書いてあるものは、その条件が立ったときだけ見直す。数値は判断した時点の実測である。

## 1. Next.js に留まる（2026-09-14）

Vite + React Router 7 への移行を検討し、Next 16 に留まると決めた。きっかけは「LLM は Next を推しすぎるが、(a) キャッシュの把握、(b) `use client` 境界の管理、(c) Vercel 依存のコストを数えない」という批判で、3 つの軸をこのリポジトリの証拠だけで検証した。

- **(c) Vercel 依存は 0**（`vercel` の grep 0 件、Tailscale Funnel + `next start`、`next/image` 0 件、edge / ISR 不使用）。ただし「ビルドツールとしての Next への結合」と読み替えると成立し、これが最も強い軸である。`next.config.ts` の大半は Next 自身への回避策で、`next/image` を import していないのに `/_next/image` の DoS advisory を踏み、未使用の `sharp` に `overrides` を強いられた（`7c7e554`）。
- **(a) は一度だけ支払い、再発していない**（413 コミット中、件名に cache / revalidate / dynamic を含むもの 0 件）。記録は「RSS/Atom フィード」§7・§7.1。
- **(b) は逆向きに不成立。** 境界が原因の不具合コミットは 0 件で、`use client` はすべて `components/` にある。`server-only` の 13 モジュールは、移行すると失う防御である。

**理由**: 移行のコストは書き換え（全体の約 7%）より、E2E スイートの再認定にあり、15〜20 営業日と見積もった。本番の便益は 0 である（全ページ `force-dynamic`、キャッシュ層は実質未使用、単一 Node プロセスという形は RR7 でも同じ）。

**見直す条件**: ① Next の major 更新が強制され、その追随の見積もりが 15〜20 営業日に近づいたとき（再認定が同額になり差が消える）。② Next が原因のセキュリティ更新が年 3 回以上になったとき（判断時点で 4 か月に 1 回）。③ `app/` の SSR を捨てると決めたとき。

**限界**: 開発ループの便益は測っていない。測ったのは `next start` と `next dev` の差（約 4%、`e55d407`）だけで、Vite と Turbopack は比べていない。「便益 0」は正確には「本番の便益 0、開発の便益は未測定」である。

## 2. `app/globals.css` は 1 ファイルのまま（2026-08-18）

分割を検討し、1 ファイルのままにすると作者が決めた。候補に見えた 2 つの理由は、どちらも測って否定された（判断時点で 2071 行）。

- 「コメントの密度で大きさを説明できない唯一のファイル」は誤り。43% が説明文で、TS と同じ書き方である。
- 「エディタのクロムと公開ページのスタイルが混ざっている」も誤りで、面で分ける切れ目が最悪の選択だった。182 のトップレベルのセレクタブロックのうち 118 が `.prose`、エディタ専用は 26、4 つは 1 つの規則で両方の面を名指ししている。ファイルは機能ごとに並び、各機能はエディタと公開ページの描画を意図して隣に置いている（両者を同じに見せることが要件である）。面で分けると、揃っていなければならない対を引き裂く。

分割に反対する理由は他にもある。CSS は分割しても依存グラフも未使用の検出も得られない一方、カスケードの順序は上から読めるものから `@import` の並びに隠れた性質に変わる。このファイルは順序の依存を明示的に書いている（`@layer base` のボタン規則、`docs/editor-pitfalls.md` §12 の「何に勝つようになるか」）。CSS はほとんど検証されないので、カスケードの退行は黙って起きる。

**見直すとき**: 探しにくさが不満なら、答えは先頭の目次コメントと揃ったセクション見出しである（`link-requirements.md` が `ce7e53b` で同じ問題に出した答え）。それでも分けるなら、面ではなく機能で切る。`@import 'tailwindcss'`・`@plugin`・`@theme`・`:root`・`@layer base` は入口のファイルに残す。Tailwind v4 は `@import` を自分でまとめるので postcss-import は要らない。

## 3. PostEditor の公開状態の機械はインラインのまま（2026-08-18）

`components/PostEditor.tsx` の公開・セッションの状態機械と、そこから導くラベルの論理は、どちらも切り出さない。2 つの案を見送った。

- **`usePublishFlow`（作る前に却下）**: 公開状態と `useAutosave` は互いに依存している（フックは `committedIdRef` と公開状態を書く 3 つのコールバックを受け取り、描画中の `if (state !== handledState)` の突き合わせが `acceptSaved` を呼び返す）。循環を解くには `useAutosave` をその中に包むしかなく、そのフックは 15 個の値を返すことになる。このリポジトリのフックは 6 / 4 / 2 / 0 個である。約 117 行を動かして結合は少しも減らない。
- **`publish-controls.ts`（作って、レビューして、戻した）**: `label` / `disabled` / `status` / `autosaveStatus` の純関数と 17 の vitest。PostEditor が 402 行から 388 行に減るだけで、ファイルを 1 つ増やす価値が無いと作者が判断した。

このとき見つけた穴は塞いである。`publishDisabled` の 3 つ目の項（`!hasIdentity && autosaveState === 'saving'`）にはテストが無かったが、`e2e/publish-race-guard.spec.ts` が覆っている（`c868b53`）。危険は本物で、項を外したビルドで測ると、最初の自動保存が `id` なしで `{content}` を POST している間に公開が作成と公開の経路を取り、自動保存の応答が 2 つ目の行を作った。

**その窓の測り方**: 保存が保留中であることと、送信中であることは違う。800ms のデバウンスが明ける前にクリックすると、フォーム自身の `cancelPendingAutosave()` がタイマーを消し、自動保存は走らず、危険が無いことの証明に見える。最初の `/api/drafts` を `page.route` で止め、そのハンドラが発火してからクリックする。

### 3.1 PostEditor と LinkBubble の分割の境目（2026-09-28）

**決定**: PostEditor はこれ以上分けない。`components/editor/LinkBubble.tsx` からは、カードが文書と href に訊く純関数（`linkAtCaret`・`editableLinkText`・`displayHref`・`faviconSrc`）だけを `components/editor/link-at-caret.ts` に出した。どちらも行数は理由にしていない。

- **PostEditor**: 上の 2 案が扱わなかった境目はヘッダバーの component 化（約 125 行）だけである。8 月以降の変更はヘッダ・＋ ドロワー・記事の設定に集まっているが、切り出すと props が約 14 個になり（公開の状態・ラベル・disabled、自動保存の表示、InsertMenu の開閉、画像アップロード、ヘルプと設定の開閉、`state.error` など）、親との結合は減らない。ヘッダが props ではなく自分の状態を持ち始めたら見直す。
- **LinkBubble で出した理由はテストの層である。** `linkAtCaret` と `editableLinkText` は文書と選択についての主張で、それまで E2E でしか測れていなかった（AGENTS.md の「Where an editor test goes」）。`EditorState` を受け取る形にし、`components/editor/link-at-caret.test.ts` が右端・左端・選択・一様なマーク・インラインのアトム・脚注定義の中を測る。基準 5p・7f（`docs/link-requirements.md` §5.5.10・§5.5.12）はこのファイルに移した。
- **LinkBubble に残したもの**: `editingRef` / `dismissedRef` / `leavingRef`、`shouldShow`、blur・focusout・mousedown・keydown の規則、位置直しの layout effect は、ref とタイミングでつながった 1 つの状態機械である（`docs/editor-pitfalls.md` §10.4・§10.5）。hook に分けても結合は残り、順序が hook の境界の向こうに隠れるだけになる。
- **次に触るときに判断するもの**: 見出し候補（`docs/link-requirements.md` §5.5.17。約 200 行、hook にすると入出力が 6〜8 個）とタイトル取得の effect（§5.5.10。約 25 行）。どちらも境目としては成り立つが、テストの層は変わらない。

## 4. 絵文字のアイキャッチ（2026-09-24、作って見送り）

Zenn 型の絵文字アイキャッチを、画像のサムネイルと択一の代替として作った。捨てるブランチで全テスト緑まで作り、作者が実物を見て「画像だけでよく絵文字は不要」と決めた。コミットしていない。

**理由（作者自身の理由）**: ① 著者に 2 種類のサムネイルから選ばせるのは負担である。② 写真・本文画像・絵文字・空白が混ざると一覧の見た目が不揃いになる。描き方が嫌だったのではない。

埋めようとした穴（文字だけの記事は一覧やカードに何も出ない）は認めた上で先送りした。作者が考えている答えは、サイト側で持つ、タイトルを書いたカードである。作るなら一覧とリンクカードは HTML / CSS で描く（日本語はブラウザが描くのでフォントの問題が無い）。og:image は `/og.png` のままにする。記事ごとに日本語タイトルの画像を作るには、約 10MB の CJK フォントか実行時のフォント取得が要る（`app/shared-metadata.ts`）。

**復活させるなら、動いた設計**: 絵文字を同じ `posts.thumbnail` 列に保存する（択一が自然に保たれ、マイグレーションも列名の変更も要らない。`posts` の列名を変えるとテーブルを作り直すことになる）。解決関数は画像 / 絵文字 / なしを返し、`resolveThumbnail` をその画像だけの見方にする（og:image は `/og.png` に落ちる）。絵文字の判定は `new RegExp` で `v` フラグ付きの `^\p{RGI_Emoji}$`（tsconfig の target が ES2017 のため）。リンクカードの `CardImage` を広げ、4 つの描画側が対応するまで型検査で落ちるようにする。

## 5. GitHub リポジトリ専用のカード（2026-09-04、議論のみ）

★数や言語を出す GitHub リポジトリ専用のカードは作らない。汎用の外部リンクカード（og:image ベース）で足りる。

- GitHub の og:image（`opengraph.githubassets.com`）には★数と言語が画像として焼き込まれているが、このサイトのカードのサムネイルは 128×80px 固定なので数字が読めない。情報が無いのではなく読めないだけで、タイトルと説明は文字なので読める。
- 前例: Zenn の `github` 埋め込みは blob パーマリンクのコード埋め込みで、リポジトリカードではない。Qiita（`increments/qiita-markdown`）には GitHub の埋め込みが無い。dev.to（`forem/forem` の `GithubReadmeTag`）にはあるが、owner/repo 名・説明・README の冒頭だけで、★数・フォーク数・言語は出していない。
- 需要も測っていない（このブログでリポジトリをカードにしたい実例がまだ無い）。

**見直すとき**: ★数や言語が実際に欲しくなったら、専用のカードを丸ごと作るのではなく、`api.github.com` から `stargazers_count` と `language` の 2 つだけを取って文字のバッジで出す。画像に頼らないので小さいサムネイルでも読める。これが唯一の未着手の代替案である。

# 本文画像の配置と枠（他社の実測、2026-09-07）

本文の画像を中央に置くか、枠を付けるかを決める材料として、Zenn・Qiita・note を単体の Chrome のプローブと各社のスタイルシートで測った。キャプションの実測は「画像キャプション」§1 にある。

|                                  | Zenn                                                                                 | Qiita                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 配置                             | 中央                                                                                 | 左寄せ                                                            |
| 機構                             | `.znc img.md-img { margin: 1.5rem auto; display: table }`                            | `img { margin: 0 }`、インライン、親は `text-align: start`         |
| 枠                               | 無し                                                                                 | `box-shadow: 0 0 0 1px var(--color-divider)`（`border` ではない） |
| 背景                             | `background: var(--c-bg-image)`                                                      | `background-color: var(--color-gray0)`                            |
| ラッパ                           | 画像自身。リンク付きなら `.znc a:has(img.md-img) { margin: 0 auto; display: table }` | `<a>`（原寸へのリンクだけで、枠ではない）                         |
| マット（列幅いっぱいの枠＋塗り） | 無し                                                                                 | 無し                                                              |

- **note は第 3 の型で、幅をスタイルではなく保存している。** 構造は `figure > a > img` で、`<a>` が `display: table`。枠は `border: 1px solid #f5f8fa`。決め手はマークアップにあり、`<img width="620" height="187" src="…?width=1200">` のように、エディタが列の幅を HTML 属性として書き、2 倍の画像を配る。`![alt](src)` は幅を持たないので、この型を真似るには保存形式を変える必要がある。狭い画像の配置は測れていない（標本の画像がどちらもちょうど列幅だった）。
- 標本の確かさ: Qiita の左寄せは、条件を満たす描画の標本（664px の列に 600px の画像 3 枚、`margin: 0`）と宣言の両方で確かめた。Zenn の中央寄せは宣言だけによる。標本の 7 枚すべてが 708px の列より広く、`max-width: 100%` で詰まって、どちらにしても余白は 0 だった。自然な幅が列より明らかに狭くない画像は、配置について何も測らない。

## このブログに持ち込めること

1. `margin: auto` で画像を中央に置くには `display: table`（または `block`）が要る。`<img>` は既定でインラインなので、自動の余白は何もしない。
2. Qiita の枠は `border` ではなく `box-shadow` の輪である。境界ボックスを大きくしないので、レイアウトを変えず、画像の矩形も動かさない。このリポジトリでは、バブルメニューの基準点と `.thumbnail-image` の輪郭がそのまま残る（`docs/editor-pitfalls.md` §13）。
3. 両社とも `<img>` 自身に背景色を付けている。透過 PNG は、そうしないとページの地が透けて、ダークモードでは穴に見える。アップロード済みの画像には既に RGBA の PNG がある。

**決まること**: 中央に置くかどうかは好みの問題で、慣習の後ろ盾は無い（日本の主要な技術ブログ 2 社で割れている）。列幅いっぱいのマットは、どちらのサイトにも前例が無い。
