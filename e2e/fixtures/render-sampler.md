<!--
Manual-QA fixture for the PUBLIC render pipeline (lib/render.ts), not a spec input.
Paste the body below into a post to see every block the pipeline treats specially on
one page: heading levels, both diff fence forms, a callout, a list, a fence nested in
a quote, a pipe table, and an in-page anchor link.

Rebuilt from the throwaway post that lived in the local DB as id 36 — the only place
this combination of blocks existed — before that row was deleted. Not a copy of it:
the filler text is replaced by labels, and a filename-only fence, a nested list item
and the anchor link are additions. Keep the block kinds when editing; the point is
the coverage, not the prose.
-->

## 見出しレベルとリンク

本文中の [表のセクションへ](#表) というリンクは、sanitize が id を書き換えた後の名前を指す必要がある（`lib/rehype-clobber-fragment-links.ts`）。見出しが3つ以上あるので目次も出る。

### 小見出し

## コードブロック

言語指定なしの diff フェンス:

```diff
--- a/example.js
- console.log(Hello)
+ console.log(hello)
```

言語とファイル名を伴う diff フェンス（ヘッダにファイル名、行に diff 色）:

```diff_ts:example.ts
export const MarkdownTable = Table.extend({
-  addStorage() {},
+  addStorage() {
+    return {};
+  },
});
```

ファイル名のみ:

```ts:plain.ts
const x = 1;
```

## 引用と囲み

> [!WARNING]
>
> 警告の囲み。アイコンとラベルは CSS 側で付く。

引用の中に入れたフェンス:

> 引用の本文。
>
> ```
> 言語指定のないフェンス
> ```

- 箇条書きの項目
- 2つ目の項目
  - 入れ子の項目

## 表

| 列A     | 列B  | 列C    | 列D      |
| ------- | ---- | ------ | -------- |
| adsf    | aa   | あああ | fsdaffsd |
| 0.3     | aff  | df     | fsa      |
| fasdfas | dfas | fsa    | fad      |
