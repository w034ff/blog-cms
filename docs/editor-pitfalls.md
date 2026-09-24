# エディタの落とし穴（TipTap / ProseMirror）

PostEditor（TipTap 3 + ProseMirror）を実装・修正する中で実測した、ライブラリの挙動とその帰結の記録。requirements 文書が「この機能をどう作ったか」を記録するのに対し、この文書は「機能をまたいで何度でも踏む性質」を記録する。個々の機能の設計判断はそれぞれの requirements 文書にあり、ここでは重複させずに節番号で指す。

- **編集規則は `docs/*-requirements.md` と同じ**（AGENTS.md）。節番号は API である。既存の節を振り直さず、追記は末尾か該当節の下位番号に置く。
- `node_modules` 内の記述は grep できる識別子で引く。行番号は依存を更新すると黙って腐る。
- 実測値には日付を付ける。以下で「測定」と書いたものはブラウザ（E2E ハーネス、または実ブラウザでの作者の確認）で観測したもの、「静的」と書いたものはソースを読んだだけのものである。
- 本文中のバージョンは測定した時点のもの。2026-09-24 時点のインストール版は `@tiptap/core` 3.31.3。

2026-09-24 に Claude のプロジェクト memory から移した（§1〜§12 は `tiptap-editor-pitfalls` と `dead-backspace-duplicate-pm-state`、§13〜§17 は機能ごとの小さな記録 12 件）。移すにあたって、引いている識別子がリポジトリと `node_modules` に今もあるかを静的に照合した。ブラウザでの再測定はしていない。

## 1. 調べ方

**推測せず、プローブする。** この文書の項目の多くは、最初の説明が外れていて、ブラウザで測って初めて決着した。

- エディタは view の DOM から取れる。ソースを変えずに `page.evaluate` の中で `(document.querySelector('.ProseMirror') as Element & { editor: Editor }).editor`。
- 誰がキーを消費したかは、使い捨ての spec で `editor.on('transaction', ({ transaction, appendedTransactions }) => …)` を記録する（`docChanged` / `selectionSet` / steps / meta のキー）か、`view.someProp` / `view.endOfTextblock` / `view.dispatch` を spy する。使い終えたら消す。

### 1.1 選択の 20ms デバウンスは、操作だけでなく計測も壊す

ProseMirror は DOM の選択を 20ms のデバウンスで state に取り込む。

- 速く打つ spec はフェンス変換などの後に `expect()` を挟む。追い越すとキーが keymap を通らない（`e2e/editor-codeblock-boundary.spec.ts` の `caretAtLineStart`）。
- `keyboard.press('ArrowLeft')` の直後に `state.selection` を 1 回読むと、キャレットは動いていないように見え、「このキーはここでは効かない」と読めてしまう。2026-08-03 には、アコーディオンの本文から ArrowLeft でタイトルに届かないと誤って報告し、作者に実ブラウザで訂正された。Chrome が自前で処理する移動（素の矢印）が最悪で、同じ実行の対照がたまたま間に合って結果を裏付けたように見えた。
- クリックによるキャレット移動も同じだけ遅れる（§7.3）。

**規則**: キャレットは常に `expect.poll(() => caret(page))` で読む。「キーが何もしなかった」は最も証拠を要する仮説として扱う。配置ガードに問い合わせるクリックの後は `settle(page)` する。

### 1.2 「何も起きない」失敗は `pageerror` にしか出ない

文書をバイト単位で変えずに失敗するものがある。文書の形を見るプローブはそれを「何も起きない」と読み、通ってしまう。

- 捕捉されない throw（§8.1 の `RangeError`、§10.1 の `Illegal invocation`）は `page.on('console')` にも出ない。
- `Transform.insert` / `replace` は黙って拒む。当てはまらないスライスでは `replaceStep` が null を返してステップが足されず、throw は 1 行後の `NodeSelection.create`（`nodeAfter` が null）で起きる。2026-08-12、ブロックドラッグハンドルの `findBoundary` が `doc.content.size` を落とし先に出し、脚注定義の下へのドラッグがマウスアップで落ちた（`endOfBlocks()` で修正。`docs/footnote-requirements.md` §6.6）。
- 拒まれた insert を検出するには `tr.steps.length` を数える。先に `delete` が走っていれば `tr.docChanged` は役に立たない。

**規則**: 「キーが効かない」報告を調べる spec には `page.on('pageerror')` を付ける。`e2e/editor-link-bubble.spec.ts` はこれを常設している。

### 1.3 Playwright の入力が届かないもの

- `page.mouse` は OS のドラッグループに入らない（`e2e/native-drag.ts`）。ネイティブドラッグを経由するバグは、きれいな陰性が出ても当てにならない。継ぎ目で測る。キャンセル可能な `DragEvent('dragstart')` を投げて `defaultPrevented` を見る。
- CDP の入力はメインフレームのウィジェットに送られ、プロセス外の `<iframe>` へのヒットテスト振り分けを通らない。クロスオリジンのフレーム上でも親がイベントを受け取り続けるので、「iframe 上でも mouseup は届く」という測定は誤りだった（2026-08-25）。同一オリジンのフレームで測り直すと、32 回の move のうち親に届いたのは 0 回で、mouseup も届かなかった。
- `.click()` は mousedown と mouseup を 1 タスク内で発火する。押している間にメニューが消えるバグ（§10.4）を見るには、`hover()` → `mouse.down()` → `waitForTimeout(150)` → メニューが見えていることを assert → `mouse.up()` とする。z-index の問題と区別するため、文書のずっと下で行う。
- `Control+k` は CDP で合成されるので、ブラウザ UI に届かない。Chrome のアドレスバーから `Mod-k` を奪えるかは実ブラウザでしか分からない（`docs/link-requirements.md` §9）。

### 1.4 その他の計測の罠

- Tailwind v4 のパレット色は `getComputedStyle` で `lab(...)` として返る（zinc-700 は `lab(26.8019 1.35387 -4.68303)`）。`rgb()` で返るのはこのリポジトリの CSS に書いたリテラルの hex だけである。手を付けていない要素は「新しい色ではない」と assert する。汎用ルールの退行は何かを塗ることで起きるので、そのほうが鋭い主張にもなる。
- `TocNavMobile` と `TocNavDesktop` は両方描画され、どちらも `aria-label='目次'` を持つ。DOM で先に来るのは隠れた mobile 側なので、`.first()` は見えないほうを拾う。`nav[aria-label="目次"]:visible` を使う。
- アサーションのない「計測用」spec は、変更後に再実行しても何も教えない（§10.2 の範囲置換のコストはそれで見逃した）。
- 完全な受け入れ基準表は「何を求めたか」の証拠であって、「機能が何をするか」の証拠ではない。脚注の「21/21 基準を実測」は、定義の順序を測る基準が無いことを隠していた（`docs/footnote-requirements.md` 基準 3b）。

## 2. 入力ルールと keymap

### 2.1 追加トランザクションは入力ルールの取り消し記録を消す

`@tiptap/core` の inputRulesPlugin は、`tr.selectionSet || tr.docChanged ? null : prev` で取り消し記録を捨てる。文書末でブロックを作る入力ルールが発火すると、同じ dispatch 内の TrailingNode の追加トランザクション（docChanged）が記録を消し、Backspace で打った記法に戻れなくなる。対象はすべてのブロック記法（`:::info `、`:::details `、`> `、`## `、`- `、` ``` `）。

**機構**: StarterKit の TrailingNode を切り（`trailingNode: false`）、`components/editor/trailing-node-extension.ts` に置き換えている。取り消し記録が生きている間（1 トランザクション。次の打鍵・クリック・矢印で解ける）は追加を待つ。判定は `components/editor/input-rule-undo.ts` の共有関数 `hasUndoableInputRule`。2026-08-04（`efeebc5`）。

- 待たずに通すべき場合が 2 つある。アコーディオンの `persist: false` のトグルが 1 フレーム後に空のフォーカストランザクションを返すこと、そして Backspace が先に来た場合（`undoInputRule` が段落を戻すので、追加するものが無い）。
- 履歴トランザクションは飛ばす。undo に乗った追加は次の Ctrl+Z を生き延び、空行を残す。
- TipTap は入力ルールのプラグインを拡張ごとに 1 つ作る（2026-08 時点で 13 個）。逆操作を持つのは発火したものだけで、最初の 1 つだけを見ても何も見つからない（`78a2222`）。
- コードブロックの古い回避策（`code-block-extension.ts` の `fenceUndoKey` + `undoFenceTyping`）は残っており、意図して触っていない。

### 2.2 拡張の keymap はコアの Keymap より先に走る

`ExtensionManager.plugins` は拡張の並びを逆にする。`useEditor` の配列で後にある拡張が勝つ。ノード自身の Backspace ハンドラ（CodeBlock の空→解除など）は、コアの `undoInputRule` を隠す。ネイティブの取り消しが欲しい拡張は、自分のハンドラの最初で `editor.commands.undoInputRule()` を呼ぶ。

同じ逆順は `handleDrop` などの props にも効く（§7.2 の `IsolatingBoundary.handleDrop` と `tableDropGuard`）。

## 3. NodeView と DOM

### 3.1 Chrome はネイティブの削除で NodeView の contentDOM を壊すことがある

コードブロックの最後の 1 文字をネイティブに消すと、Chrome は空になった `<pre><code>` を直前の `contenteditable=false` のヘッダに畳み込み、DOM から取り除いた。コンテンツの穴に限った `ignoreMutation` がこれを ProseMirror から隠し、view とモデルが恒久的にずれた。

**機構**: `code-block-extension.ts` の `deleteSoleCodeChar` が、空にする削除（Backspace / Delete / 単語削除の各キー）を ProseMirror 経由で行う。`ignoreMutation` は `!code.isConnected` のとき false を返し、PM に描き直させる。

## 4. バンドル時に prosemirror が二重になる

**`npm ls` が重複排除済みの 1 コピーしか示さなくても、バンドル済みの拡張が `prosemirror-*` の 2 つ目のコピーを内包していることがある。** 分裂はバンドル時に起きるので、依存木にも Turbopack にも現れない。

- 起きたこと（2026-07-14 診断、07-15 修正）: `@tiptap/extension-blockquote@3.27.1` の dist が prosemirror-model / -transform / -state を内包していた。その `handleBackspace` が最後に作る `TextSelection` は、リネームされた 2 つ目のクラス `_TextSelection` のインスタンスだった。prosemirror-view の `captureKeyDown` → `stopNativeHorizontalDelete` は `selection instanceof TextSelection` で守っており、自分の正規コピーと比べて失敗し、編集なしで `preventDefault()` した。引用の中へ段落を Backspace で結合した直後の、次の Backspace が効かなくなった。
- 見分け方: `selection.constructor.name` が `_TextSelection` なら壊れている。回帰テストは `e2e/editor-quote-backspace.spec.ts`。
- 源流の修正: 3.28.0 の `@tiptap/extension-blockquote` は `@tiptap/pm/state` を import するようになった（`3796059`、2026-07-21）。ビルド時のカナリア `test/no-inlined-prosemirror.test.ts` は内包しているパッケージを 0 件と見て `HANDLED = []` のまま、再導入の見張りとして残っている。
- 行き止まり（再試行しない）: `next.config` の `turbopack.resolveAlias` で prosemirror-state などを固定しても効かない。重複は dist に内包されていて、別名にする import 指定子が無い。絶対パスへの別名はそもそも失敗する（Turbopack が `.` を前置する）。

### 4.1 `blockquote-extension.ts` を残している理由

`components/editor/blockquote-extension.ts` は `Blockquote.extend` で Backspace だけを上書きしている。instanceof の理由はもう無いが、上流の `handleBackspace` は 3.28.0 の時点で 1 段しか見ない（直前の引用の最後の子がテキストブロックのときだけ結合し、それ以外は lift する）。入れ子の引用では、lift と ProseMirror 既定の引用への結合が行き来して、Backspace が永遠に振動した。`joinIntoBlockquote` は直前の引用の末尾をいちばん深いテキストブロックまで降りて結合し、lift の分岐を持たない。消すと振動が戻る。

### 4.2 @tiptap を更新するとき

- ファミリーを揃えて上げる。starter-kit の推移的依存は `^` で浮くので、一部だけ固定すると ERESOLVE になる。
- 古い `package-lock.json` のまま揃えて上げると「Conflicting peer dependency @tiptap/pm」で ERESOLVE になる。`package-lock.json` の `packages` から `@tiptap/*` を外し、`node_modules/@tiptap` を消してから入れ直す（`@tiptap` の部分木だけが再解決される）。依存導入の規則（クールダウン）に従う。
- `components/editor/clear-nodes-extension.ts` は上流 `src/commands/clearNodes.ts` の写しを持つ（§8.2）。更新のたびに差分を取り、見出しコメントの版を書き換える（3.31.3 で照合済み）。
- `isolating` を前提にしたリポジトリのコメントが、インストール版の dist と食い違っている例がある（§6.4）。更新のたびに dist と照合する。

## 5. ブロックドラッグ

`components/editor/block-drag-handle.ts` の DragController は、mousedown で掴んだ `node` / `from` / `to` を持ち回る独自のドラッグである。設計の記録は `docs/link-card-requirements.md` §7.2・§7.5・§7.7 と `docs/embed-requirements.md` §8.1・§10.10。

### 5.1 掴んだ位置を持ち回るドラッグはモーダルにするか、文書の変化で中止する

ドラッグ中に Delete を押すと `deleteSelection` がブロックを消し、マウスアップ時の `applyMove` の古い `from` / `to` は文書末を越えて `tr.delete()` が throw した。その前の段階では、掴んだ `node` を落とし先に再挿入して、消したブロックを蘇らせていた（2026-07-21 修正）。

**機構**:

- プラグインの `props.handleKeyDown` が、`controller.isDragging()` の間は編集キーを飲み、Escape で中止する。PM の keymap より先に走るので、編集は文書に届かない。window の keydown では後から発火するので間に合わない。
- `view().update` が、外部・非同期の変更に備えて `doc !== prevState.doc` で中止する。
- `isDragging()` は「セッションがある」ではなく「`DRAG_THRESHOLD` を越えた」を意味する。

### 5.2 モーダルなドラッグを取り残すのは、その上で始まったネイティブ HTML5 ドラッグである

ネイティブドラッグの OS ループは、その間の `mousemove` と `mouseup` を飲む。エディタ内のネイティブドラッグを測ると `mousedown → dragstart → drop` で、mouseup が一度も来ない。mouseup でしか終わらないセッションは終わらず、`body.block-dragging` の `user-select: none` でクリックがキャレットを置かなくなり、`handleKeyDown` がすべてのキーを飲み続ける。

**機構**（4 つ）:

- セッション中の `dragstart` をキャンセルする（根本の修正。発生源を問わない）。
- `dragend` / `drop` / window の `blur` で中止する。
- mousemove ハンドラで `if (event.buttons === 0) endSession()` とする。失われた mouseup から次の移動で回復する（prosemirror-view も自前の MouseDown に同じガードを持つ）。
- ハンドルに `-webkit-user-drag: none` を付ける。

`pointercancel` は使わない。DnD がポインタを取ったときに発火し、正当なドラッグを殺す。

この修正が生んだ 2 つの副作用は、どちらも測定済みである。

- 押下を `preventDefault` しないと、ブラウザがポインタの後ろに本物のテキスト選択を描く。PM の mousedown が NodeSelection をキャレットに変え、`.ProseMirror-hideselection`（@tiptap/core は注入する）が効かなくなるためである。`getSelection()` はどちらでも NodeSelection の範囲を返し、`::selection` は計算値を読めないので、選択色の画素数で測る（静止時 188、ドラッグ中 3709）。しきい値で NodeSelection を戻しても直らない。押下中は `selectionToDOM` が DOM の選択に触らない。
- `preventDefault` すると `LeftMouseDown.up` の選択移動が失われ、ただのクリックでブロック全体が選択されたまま残り、次の打鍵でブロックが置き換わる。`DRAG_THRESHOLD` を越えなかった押下には `Selection.near` でキャレットを返す。

最初に書いた spec のうち 2 つは空振りしていた。押下中に `dragstart` を assert しても、ガード無しで通る（セッション中は DragController 自身もキャンセルする）。目標へ 1 回で動かすと、ブラウザは描く選択を持たない。先に短く動かす必要がある。

同じ回に見つけて直したが、報告の原因ではなかったもの: ドラッグ中の自動スクロール（下端付近の帯で rAF ループ、フレーム間隔で調整）、ホイールで落とし先が動かないこと（`findBoundary` はビューポート座標で答えるので、キャプチャ段の `scroll` で最後の `clientX` / `clientY` から計算し直す）、`event.button` を見ていなかったこと（右ドラッグで並べ替わった）。

### 5.3 ネイティブのブロックドラッグは閉じている

2026-08-22 に「エディタがフリーズ」と報告された。凍結時に作者のブラウザで測ると、`body.block-dragging` は無く（こちらのセッションではない）、`selection` は NodeSelection、`view.dragging` が true だった。`drop` も `dragend` も `view.dom` に届いていない（prosemirror-view は `view.dragging` を `drop` の `finally` か `dragend` の 50ms 後でしか消さず、独立した回復タイマーを持たない）。Escape でも戻らなかった。

**決定**: 修復せずにジェスチャを閉じる（`994c1b0`、作者が確認済み）。`handleDOMEvents.dragstart` がネイティブドラッグをキャンセルし、`handleDOMEvents.mousedown` が同じ押下で DragController のドラッグを始めるので、失うものは無い。Chrome の中で何が止まるのかはこのハーネスでは測れない。

- ガードの範囲は `view.state.selection instanceof NodeSelection`（型も深さも問わない）。prosemirror-view の武装の仕組みには型の確認が無く、Ctrl/Cmd+クリック（`selectNodeModifier` → `selectClickedNode`）はどの選択可能ノードも NodeSelection にし、ただのクリックもインラインのアトムに同じことをする（`selectClickedLeaf`）。2026-08-23。
- さらに、押下点が `view.dom` の中で `[draggable="true"]` の祖先を持つ場合も拒む（`pressedNativeDragSource`、2026-09-08）。`embed` / `linkCard` / `image` は、選択が無くても `draggable="true"` を恒久的に持つ（prosemirror-view の `if (node.type.spec.draggable) dom.draggable = true`）。`LeftMouseDown` は `targetNode.type.spec.draggable` の最初の分岐で `mightDrag` を武装するので、NodeSelection のガードでは未選択の最初の押下を覆えなかった。範囲は属性で決める。「`DRAGGABLE_TYPES` のブロックの中」で決めると、引用やコードブロックからのテキスト選択ドラッグ（すべての drop ガードの前提）を殺す。
- その漏れが実際に生んでいたのはフリーズではなく、画像の drop オーバーレイだった。Chrome は画像そのものからページ内ドラッグを作り、`dragstart` で dataTransfer に File（`image/png`）を入れる。PM の `clearData()` はそれを消さず（直後の `types` は `["Files"]`）、`useImageUpload` は外から来たファイルと読んだ。測定（2026-09-08、ガードを外した 1 回限りの実行）では、drop が画像を再アップロードし（`POST /api/uploads` が 1 回）、2 つ目のコピーを挿入し、落ちた段落を分割した。記録は `docs/link-card-requirements.md` §7.7。
- 前提（`spec.draggable` を持つノード型 ⊆ `DRAGGABLE_TYPES`）は `components/editor/draggable-types.test.ts` が `postEditorExtensions` から検査する。
- drop 側は駆動できる。本物のマウスで `dragstart` を起こして `view.dragging` を立てた後、`Input.dispatchDragEvent` に渡す `DragData` の `files: ['<絶対パス>']` に自分でファイルを入れる（`e2e/native-drag.ts` はこの欄を使っていない）。陰性を信じる前に、File が届いたことを assert する。

**仮説（未確認）**: Chrome は、OS のドラッグループが初期化される間にドラッグ元の DOM 要素が変更されるとセッションを失い、`dragend` / `drop` を二度と出さない（react-dnd#2177、react-dnd#733。Firefox は回復する）。本体を押すと `LeftMouseDown` が同期的に NodeSelection を作り、`NodeViewDesc.selectNode()` が同じフレームで同じ要素に `draggable=true` とクラスを付ける。⠿ ハンドルの経路は `dom.draggable` に触らない。症状の形が一致するだけで、Chromium 内部の記録は無い。

フリーズがまた報告されたら、それは別の経路である。

- まず Escape が効くかを尋ねる。青枠が出ていてキーが死ぬのは、DragController のセッションが生きている印である（`handleKeyDown` が Escape 以外を飲む）。Escape も死ぬならブラウザ側である。
- 使い捨ての診断スクリプト（`public/drag-log.js`。drag / mouse / keydown をエディタの状態と一緒に記録し、`dumpDragLog()` で読む）は削除済み。作り直すときに決め手になるのは、凍結中に `keydown` がまだ届くかどうかである。
- 中止の条件（`dragend` / `drop` / `blur` / 次の mousemove の `buttons === 0`）は、止まった OS ループが決して送らないものばかりである。ループが送り続ける `dragover` / `dragenter` は聞いていない。試していない回復の扉である。

「フリーズ」の報告は、ハングよりも出口の無いジェスチャであることのほうがずっと多い。

### 5.4 `<iframe>` は親ウィンドウのマウスイベントを飲む

ブロックドラッグ全体が `window` の `mousemove` で動いている。選択された埋め込みの iframe はポインタを受け取るので、掴んだ埋め込み自身の枠の上でゴーストが止まり、mouseup が来なかった（2026-08-24 報告、08-25 修正）。

**機構**: `body.block-dragging .embed-frame iframe { pointer-events: none !important }`。ジェスチャの途中でフレームが付くことがあるので、掴んだ時点の JS ではなく CSS で行う。`docs/embed-requirements.md` §8.1、基準 E12。

### 5.5 ゴーストが iframe を複製すると、第 2 の話者になる

ゴーストが NodeView を丸ごと複製していた頃は、ドラッグ中に同じ `embedId` を持つ X のフレームが 2 つあり、複製の `resize` が本物のブロックを縮めた（2026-08-24）。

**機構**: `block-drag-handle.ts` の `previewContent` が複製を付ける前に `<iframe>` をすべて外し、埋め込みは `embedToken` で描く。`embed-extension.ts` の `onMessage` は `event.source === iframe.contentWindow` も要求する。`docs/embed-requirements.md` §10.10、基準 X9 / X10。

## 6. isolating の境界

### 6.1 `isolating: true` は、ノードの縁をまたぐ範囲置換を守らない

prosemirror-transform の isolating の検査（`coveredDepths`、`deleteRange` のブロック境界の拡張、`Fitter.findFittable`）は、どれもスライスを置く場所を守る。置換が閉じる前線は誰も守らない。`p, callout(p("囲みの中身です")), p("後の段落です")` で縁をまたいで選択し Backspace すると、下の縁では囲みが下の段落を飲み、上の縁では囲みが壊れて上の段落に吸収された（フェンスは言語とファイル名を失う）。2026-07-27 発見、07-28 修正。

**機構**: `components/editor/isolating-boundary.ts` が削除を縁で切る（`clampedDeleteRanges`）。囲みの内側と外側を、1 トランザクションの別々の範囲として消す（範囲が非対称でも fitter は再結合しない。測定済み）。

- 入口は 7 つあり、見つけ切ることが仕事だった。Backspace / Delete と 4 つの単語削除キー、`handleTextInput`、Enter（切ってから baseKeymap の Enter チェーン）、`cut`（DOM ハンドラ。コンテキストメニューはキー無しで発火する）、`handlePaste`、`compositionstart`（IME は `handleTextInput` に届かない。日本語のサイトではそれが入力の経路である）、`handleDrop`（移動ドラッグの元の削除。どの keymap からも届かない）。
- どれも `selection instanceof TextSelection` で絞る。この 1 つで AllSelection / CellSelection / NodeSelection が外れ、それぞれ自分の挙動を保つ。
- 削除が直ったので、縁をまたぐドラッグは拒まず修復する。`unwrapHalfSelectedCallouts` は `transformPasted` にあり、prosemirror-view はこれをクリップボードのスライスにもドラッグのスライスにも適用する。
- drop インジケータのフックは自分でスライスを修復する。prosemirror-view が変換するのはローカルの写しだけで、`view.dragging.slice` は生の形のまま残る。
- 編集上の規則として、callout は callout の中にも blockquote の中にも置けない（`CALLOUT_HOSTILE_ANCESTORS` / `wouldNestCallout`）。引用の場合は保存の問題ではなく帰属の問題である（`> > [!NOTE]` は往復できる）。`setCallout` は以前から拒んでいたが、drop と paste は 2026-07-27 まで迂回していた。方針がコマンドにあるときは、ジェスチャもそれを守っているかを確かめる。

### 6.2 isolating の段が 2 つあるときは、最も内側を取る

`@tiptap/extension-table` は各セルだけでなく `table` ノードにも `isolating: true` を付ける（prosemirror-tables の文書ではなく dist を確かめる）。外側を取ると削除が表の内容の縁、つまり先頭行まで伸び、上の段落から本文セルへの Backspace がヘッダ行を消した。ヘッダの無い表はパイプ形式を持たず、生の HTML で保存される。表が無くても同じ形が起きる（callout の中のコードブロックがフェンスを失った）。

- 真ん中の範囲がどこで止まるかは別の問いで、囲みではなく `$from.sharedDepth(to) + 1`（2 つの端点が兄弟になる深さ）で答える。囲みが isolating でない包み（`listItem` の中のコードブロック）を持つときに効く。
- Enter には分岐が 1 つ要る。セルから外へ出る選択は、キャレットをセルの中に戻して切るので、チェーンは `splitBlock` ではなく `setHardBreak` をする。

### 6.3 ブロック先頭の Backspace と lift

- base CodeBlock の Backspace は `$anchor.pos === 1` を「ブロックから出る」と読み、空でないブロックにも `clearNodes()` を走らせた。文書の先頭ノードであるコードブロックの頭で 1 回 Backspace すると、フェンスと言語とファイル名が消えた。
- `joinBackward` の lift への逃げ道: キャレットの親が `isolating` だと `findCutBefore` が null を返し、`joinBackward` はそれを「拒否」ではなく「結合するものが無い」と読んで `blockRange()` + `liftTarget` に落ちる。縁を守るための旗が、Backspace を破壊的な分岐に送っていた（リストの項目の中のフェンスで `bulletList` が消え、引用やアコーディオンからブロックが逃げた）。callout の中は `liftTarget` が isolating の祖先で探索を打ち切るので無事だった。
- その lift をただの no-op で拒んだのは誤りで、作者が気付いた。引用の中のフェンスが消せなくなった。markdown から読んだブロックは末尾に改行を持つので、見える文字を消しても `codeBlock("\n")` が残る。画面上は空でも `content.size === 1` である。**「見た目が空」と `content.size === 0` は別の状態**で、空であることを鍵にするガードはその隙間に答えなければならない。

**機構**: 拒まずにノードを選択する（`selectCodeBlockBackward`。prosemirror-commands の `selectNodeBackward` と同じ形）。1 回目の Backspace でブロックを選び、2 回目で消す。空の場合を外す条件は両方向に効いていて、外すと 2 回目がまた選択してブロックが消せなくなる。トップレベルのコードブロックの前にはギャップカーソルがある（prosemirror-gapcursor の `needsGap()` は `type.spec.isolating` を見る）ので、lift を拒んでも逃げ道は失われない。

**一般則**: 破壊的なジェスチャを拒否に変える前に、その拒否が唯一の経路を塞がないかを問う。no-op は自動的に安全な答えではない。

### 6.4 アコーディオンは isolating である（静的に確定、帰結は未測定）

インストール版の `@tiptap/extension-details` は、`details` と `detailsSummary` の両方に `isolating: true` を付けている（静的、2026-09-24、3.31.3）。`isolating-boundary.ts` と `code-block-extension.ts` のコメントは、以前は両ノードを isolating でないとしていた。2026-09-24 に dist に合わせて直した。

**未測定**: 汎用の切り詰め（`clampedDeleteRanges` → 入力、paste、drop、cut、IME、Backspace / Delete / Enter）がアコーディオンのタイトルと本文の縁でも発火しうる。`details-slice-guard.ts` と `slice-guard-composition.test.ts` はスライスの paste / drop しか扱っておらず、素の範囲 Backspace や選択上の入力は扱っていない。`details-extension.ts` の `enterIntoEmptyBody` / `tabIntoBody` / `detailsInputRuleUndoCaret` と衝突する可能性がある。この一帯に触る前に、実ブラウザでタイトルと本文の縁をまたいで Backspace / paste / drop / cut を試す（§6.1 の手順）。

## 7. 表

### 7.1 ペーストで表が黙って GFM のパイプ形式を失う

`isPipeTable` が false になると、シリアライザは表全体を生の HTML で書く。列の揃え（フォールバックの `text-align` は rehype-sanitize が外す）、`<thead>`、`<colgroup>` が失われ、`min-width: 50px` や `colspan="1"` のノイズが増える。経路は、複数段落のペースト（セルが 2 つ以上のブロックを持つ）と、表をまるごとセルに貼ること（コピーしたヘッダ行が本文に入る）。

**機構**: `components/editor/table-extensions.ts` のプラグイン（`tablePipeFormRepairKey` / `repairPipeTable`）が、ペーストの後の `appendTransaction` で正規化する。セルの段落を結合し、本文行の `th` を降格する。「本当にパイプ形式に戻るか」で絞るので、結合セルや意図してヘッダを外した表（`toggleHeaderRow`）には触らない。2026-07-28。

- prosemirror-tables の `handlePaste` は `insertCells` で dispatch し、meta を付けない。`tr.getMeta('paste')` / `'uiEvent'` ではセル単位のペースト経路をまるごと見逃す。
- `handleDOMEvents.paste` / `.drop` だけが、すべての `handlePaste` / `handleDrop` の申し出より先に走る。そこでクロージャの旗を立て、`appendTransaction` が読む。旗はトランザクションではなく `queueMicrotask` で下ろす。拒まれたジェスチャはトランザクションを作らず、旗が次の打鍵まで残る。
- drop を含めることは見落としかけた。「セルのテキストの中への drop はインラインで結合する」という位置の規則（`table-cell-rules.ts` の `tableDropRefusal`）は、1 段落のスライスには正しく、複数段落のスライスには誤りである。位置の理屈が「インラインで結合する」と言うときは、複数ブロックのスライスで確かめ直す。
- tiptap-markdown は `state.inTable` のとき `hardBreak` を `<br>` で書き、`| x<br>y |` はバイト単位で往復する。セルに 2 行を置くパイプ形式に安全な方法はハードブレークである。修復をペーストに限ったのは意図的で、`setContent` での修復は開いただけで保存内容を書き換え、自動保存に誰もしていない編集を渡すので採らない。

### 7.2 セルへの drop と paste は同じ問いをする — ただし完全には同じでない

位置だけを見ていた drop ガードは、ブロック（引用、フェンス、リスト、表）を運ぶスライスを通した。ProseMirror は `paragraph+` を満たすために手前で表を閉じ、後ろにヘッダ無しの表を開いた（2026-07-28。述語は `components/editor/table-cell-rules.ts`）。

- prosemirror-tables は `handlePaste` を持つが `handleDrop` は持たない。「表の内容は除外」がペースト専用なのはこの非対称のためである。CellSelection のドラッグは今のところ完全な no-op である。
- `IsolatingBoundary.handleDrop` は `tableDropGuard` より先に問われる（§2.2 の逆順）。自分で切り詰めた drop を行うので、isolating の縁をまたぐドラッグで表のガードを黙って迂回していた。今は表が拒む drop には false を返してガードに渡す。**プラグインがジェスチャを変換するのではなく実行するときは、それを誰から奪っているかを確かめる。**
- 拒否には真偽値ではなく理由が要る。位置の拒否は黙る（drop インジケータがもう隠れている。`drop-cursor-guard.ts`）。内容の拒否は通知を出す（他に作者に伝えるものが無い）。`TableDropRefusal = 'structure' | 'content' | null`。
- セル内の Enter は keymap で `setHardBreak` に結び付けている（スキーマは `paragraph+` のままなので、HTML フォールバックで保存された記事も読める）。セル内の TextSelection で絞らないと文書全体で発火する。Tab の `goToNextCell` は移動先のセルの中身を全選択するので、Tab→Enter がセルを空にしていた。Shift+Enter / Mod+Enter は `@tiptap/extension-hard-break` が直接 `setHardBreak` に結び付けていて、セルの結び付けに届いていなかった。3 つとも 1 つの門を通し、テキストブロック全体の選択は先に末尾へ畳む（`9c4f8e2`、2026-08-04）。

### 7.3 選択の遅れは、表の中では失われるのではなく誤配される

クリックによるキャレット移動は、打鍵と同じ 20ms のデバウンスで `state.selection` に遅れる。新しいセルをクリックした直後の Ctrl+V は、クリック前の CellSelection を見る。prosemirror-tables の `handlePaste` は `sel instanceof CellSelection` の分岐に入り、コピーしたセルをそのセル自身の上に書き戻す。文書はバイト単位で同じで、エラーも無い。6 回中 2 回（2026-07-29、`e2e/table-cell-paste-guard.spec.ts`）。

- 1 回で決着させた診断: キャプチャ段の `document.addEventListener('paste', …)` で `state.selection.constructor.name` と `clipboardData.getData(...)` の長さを記録する。選択の遅れとクリップボードの準備の競合を区別できる（競合説は誤りだった。12 回すべてに text/html があった）。
- 修正は state のキャレットを poll すること。収束は 6〜112ms だったので、20ms を超える固定の待ちでも足りなかった。

## 8. スキーマ

### 8.1 `block+ footnoteSection?` の文書では `defaultType` が `footnoteSection` を返す

`@tiptap/core` の `clearNodes` は `$mappedFrom.parent.contentMatchAt($mappedFrom.index())` の `defaultType` を確かめずに `setNodeMarkup` に渡す。実スキーマで測ると `0:paragraph 1:footnoteSection 2:footnoteSection …`。`block+` が満たされた後は `footnoteSection` がマッチの `next` の先頭に来て、`defaultType` は `isText || hasRequiredAttrs()` しか飛ばさない。中身が `footnoteDefinition+` のノードに設定しようとして「RangeError: Invalid content for node type footnoteSection」が捕捉されずに投げられ、文書は変わらない（2026-08-09 報告）。

- throw に要るのは、親が `doc` 自身で添字 ≥ 1 のテキストブロックである。入れ子のテキストブロックは、問いがその容器に向くので安全である。前提は `doc.contentMatchAt(i).defaultType?.name` を読めばスキーマから直接分かる。
- prosemirror-commands は同じ定型句を `defaultBlockAt()`（`isTextblock` で絞る）で解くので無事である。生の `contentMatchAt(i).defaultType` に従うコードは、この文書では地雷になる。
- 到達した経路: 空のコードブロックでの Backspace（コードブロックの側は `clearEmptyCodeBlock` が `schema.nodes.paragraph` を名指しして直した。親への委譲もやめ、空にしたフェンスはリストの項目に留まる）。そして `Mod-Alt-0` の `setParagraph()`。後者は「誰も押さない」と見積もったが、作者が同じ日に普段の使い方で踏んだ。添字 ≥ 1 の空行は記事で最もよくあるキャレット位置で、`Mod-Alt-0` は見出しやリストの後の自然な「段落に戻す」操作である。prosemirror-commands の `setBlockType` は既に `hasMarkup` の段落を飛ばすので、`setNode` が `clearNodes()` に落ちる。
- 真に空の文書（`doc(paragraph)`）は無事である。「何もない文章で」という報告は空の文書ではなく空の行を指していた。新規記事を開いてすぐ押すプローブは何も測らない。

### 8.2 `clearNodes` はすべての呼び出し元について置き換えている

**機構**: `components/editor/clear-nodes-extension.ts` は、コマンドだけの `Extension` として PostEditor の配列に入る（既定の優先度。コア拡張は前に置かれ、並べ替えは安定なので、同じ優先度のユーザー拡張が最後に集められ、コマンド名を取る）。上流の本体から式を 1 つだけ変えている。`match.matchType(paragraph)` が許すなら `paragraph` を優先し、許さなければ prosemirror-commands の `defaultBlockAt` の絞り（`isTextblock && !hasRequiredAttrs`）を使う（`5751dc9`、2026-08-10、`e2e/editor-clear-nodes.spec.ts`）。

- 上流の絞りだけでは足りない。マッチの辺を順に歩くと `heading` も通り（`level` に既定値がある）、辺の順序は添字で変わる。空行が見出しになりえた。
- 逃げの分岐は防御ではなく荷重を負っている。`clearNodes` は `detailsSummary`（親が段落を許さないテキストブロック）も訪れる。そこでは辺の走査が summary 自身を返し、以前どおりの no-op になる。null のままでも `setNodeMarkup` に渡す。偽の型は「このノードの型を保つ」と読まれ、属性はこれまでどおり既定値に戻る。
- 狭い「既に段落なら何もしない」ガードは誤った修正だった（最初に勧めて撤回した）。`clearNodes` は lift もし、`Mod-Alt-0` はリストや引用から行を出す手段である（`doc(bulletList(listItem(paragraph("項目"))), paragraph)` → `doc(paragraph("項目"), paragraph)`、測定済み）。**throw する・破壊するジェスチャを no-op に変える前に、throw しない場合にそのジェスチャが何をしているかを測る。**
- 反証済みの仮説（再導出しない）: コア keymap の Backspace の `clearNodes` は `doc(horizontalRule, heading(""))` で添字 ≥ 1 に届くように見えたが、`Selection.atStart(doc)` は選択可能な horizontalRule への NodeSelection を返すので `isAtStart` が false になり、`joinBackward` がキーを取る。`clearDocument` の appendTransaction も、全体削除の後に残る 1 ノードにしか触らない。
- `toggleList` の経路は再現できていない。コードブロックの場合は `guarded-block-toggles.ts` が既に塞いでいる。

### 8.3 `text*` のテキストブロックはインラインのアトムを拒まない — fitter が祖先を割って場所を作る

`detailsSummary` は `content: "text*"` で `footnoteReference` を持てない。ガードが無いと、タイトルの途中のキャレットでの `tr.replaceWith` が `details(summary("タイトル"), content(p("本文")))` を `details(summary("タイ"), content(p([^1],"トル")))` + 元の本文を持つ空のアコーディオンに変えた（2026-08-08）。`isolating: true` は何もしなかった。置換は縁をまたがず、内容式が拒むノードの内側で完結していたからである。

**一般則**: `isolating` は前線を守り、内容式は枠を守る。後者に違反しても no-op にはならない。

- 実スキーマで全テキストブロックに `contentMatch.matchType(footnoteReference)` を問うと、拒むのは `codeBlock` と `detailsSummary` だけで、`components/editor/footnote-placement.test.ts` がこれを固定している。3 つ目が現れれば赤になる。
- 「着地した後の位置を問う」修復は、内容式が拒む場所では盲目になる。fitter が祖先を割り、参照は割れた本文の段落に落ち、祖先を辿っても `detailsSummary` が見つからない。`hostRefusalAt` は drop だけを覆い（`handleDrop` は挿入前の文書に `posAtCoords` を問う）、paste には `handlePaste` が要った。**着地後の配置修復は、拒むノードが着地した内容の祖先のまま残る場合にしか効かない。**
- 設計の記録は `docs/footnote-requirements.md` §6.5 と `docs/accordion-requirements.md` §6.5。2 つの機能は 4 日違いで出荷され、互いについて一度も問われていなかった。

## 9. 直列化

### 9.1 区切りを持つコードブロックは保存のたびに空行が 1 つ増えていた

リストの項目（区切り `"  "`）、引用や callout（`"> "`）の中で起きた。markdown-it はフェンスの中身を改行で終えるので、markdown から読んだブロックは末尾に改行を持つ。prosemirror-markdown の `text()` はそれを最後の空行にし、`write()` は出す行すべてに区切りを付ける。閉じるフェンスの前に区切りだけの行ができ、次の読み込みで中身の空行になる。トップレベルでは区切りが `""` なので何も見えない（2026-08-03、`d753790`）。

**機構**: `code-block-extension.ts` が書く前に末尾の改行を落とす（`ensureNewLine()` がフェンス自身の改行を戻す）。

**教訓**: 1 回に 1 行ずつ増えるずれは、1 回の往復では見えない。spec は 3 回往復させる。末尾の空行は保存のたびに保たれるのではなく、数回の保存で刈り込まれ、収束する。

### 9.2 脚注の markdown 層

markdown-it-footnote とその周り（HTML 経由の解析、ラベルの保持、孤立定義の救出、`parse.setup` が毎回の解析で走ること）は `docs/footnote-requirements.md` にある。ここでは他の機能にも効く 2 点だけを残す。

- `footnote-literal-extension.ts` は撤去できない防御である。`footnote_def` は空白を含むラベルを拒み、markdown-it の `reference` ブロック規則がその行をリンク参照定義として食べる。`本文[^1]。\n\n[^1]: 注釈。` は注釈の文字を失う（開いて保存するだけでデータを失う）。拡張は `reference` を包み、`^` で始まるラベルの定義には false を返す。`Ruler.at()` は置き換える規則を取り出す手段を持たないので、元の規則は非公開の `__rules__` から取る。公開 API の代替は `disable('reference')` だけで、通常のリンク参照定義まで落とす。
- prosemirror-markdown の `esc()` は `[` と `]` を無条件にエスケープし、tiptap-markdown は `esc` も `escapeExtraCharacters` も上書きしない。拒まれた文字は `\[^1\]: …` で保存され、同じ文字に読み戻る。このエスケープはバグではなく保護である。markdown-it の脚注プラグインより先にこのガードを外すと、データの喪失が戻る。

## 10. リンクのマークとバブルメニュー

リンク機能の設計は `docs/link-requirements.md` §5.4（`[]()` 入力ルール）、§5.5（カード。§5.5.9 フォーカス、§5.5.11 `Mod-k` での位置、§5.5.12 右端、§5.5.13 テキスト欄）にある。ここには他のマークやメニューにも効く性質だけを置く。

### 10.1 `<BubbleMenu>` の prop のコールバックは `Object.create(nativeEvent)` を受け取る

`@tiptap/react` の `useMenuElementProps` は合成イベントを `Object.create(realEvent)` で作り、`target` / `currentTarget` / `preventDefault` / `stopPropagation` だけを自前のプロパティにする。他のアクセサはプロトタイプを辿って `KeyboardEvent.prototype` に届き、本物でない `this` で呼ばれて「Illegal invocation」を投げる。カードは正常に動いて見えたまま、打鍵のたびに投げていた。`event.nativeEvent.key` を読む。ポータルの内側の React 要素（URL の `<input>`）は通常の合成イベントを受け取るので問題ない（`docs/link-requirements.md` §5.5）。

### 10.2 マークの境界

- `extension-link` の `inclusive()` は `this.options.autolink` を返す。`inclusive` はオプションではなくマークのスキーマ仕様の欄で、他の拡張の `extendMarkSchema` では勝てない（`getSchemaByResolvedExtensions` は `extraMarkFields` を先に展開し、拡張自身の `inclusive` で上書きする）。変える経路は StarterKit で `link: false` にし、ローカルの `Link.extend({ inclusive: () => false })` を使うことだけである（`docs/link-requirements.md` §5.5.12）。autolink は `appendTransaction` から明示的な範囲にマークを付けるので影響を受けない。
- `getMarkRange` は両端で解決する。`@tiptap/core` の実装は `childAfter` から `childBefore` に逃げる。
- 範囲置換でも右端の規則が効く。リンクの右端まで届く置換はリンクの外に着地するので、リンクの文字をすべて打ち直すとリンクが外れる。1 文字手前で止めればマーク・href・`title` が残る。
- マークの範囲をまるごと置き換えるペーストはマークを落とし、1 文字残せば保つ。リンクに限らず、受け継ぐものが残らないからである。受け入れ済み（`docs/link-requirements.md` §10）。
- `accentEmphasis` の `excludes`（`'accentEmphasis bold italic strike code'`）は `link` を含まないので、リンク + 強調は同じ範囲に置ける。span は `<a>` の内側に描かれる（`docs/link-requirements.md` 基準 5f）。

### 10.3 コマンドの可否とチェーン

- `can().setMark('link')` は「ここはリンクを拒む」3 つの場合（`detailsSummary`、`codeBlock` の `marks: ''`、インライン `code` の `excludes: '_'`）を 1 つの述語で覆う。`can().setLink({ href })` は先に `isAllowedUri` も問う。
- `setLink({ href })` は属性をマージする。既存の `title` は URL の編集を生き延びる。
- チェーンは、拒否の前に走ったものを dispatch する。同じチェーンの `.focus()` は、後のコマンドが false を返してもフォーカスを動かす。変更の前に `can()` で門を閉じる（§11.1 も参照）。
- TipTap の入力ルールの実行部は、`$from.parent.type.spec.code` か、前後のノードが `spec.code` のマークを持つときに、規則に問う前に拒む（core の `run()`）。素の prosemirror-inputrules は親しか見ない。
- `markInputRule` は最後のキャプチャ群にマークを付けるので、`[text](url)` は表せない。独自の `new InputRule` が要る（`components/editor/link-input-rule.ts`）。`preventAutolink` は dispatch するトランザクションに付ける。

### 10.4 バブルメニューの表示と位置

- `shouldShow` は、選択か文書が変わるトランザクションでしか再評価されない。同じ場所を 2 つのメニューが欲しがるとき（表のセルの中のリンク）の調停は CSS で行う（`body.link-menu-open .table-toolbar { display: none }`。バブルメニュー自身の `onShow` / `onHide` で切り替える）。それ以外の時にメニューを出し入れするには `tr.setMeta(pluginKey, 'show' | 'hide')` を dispatch する。
- meta で出したメニューは、表示の前に位置を決める。`transactionHandler` は `updatePosition()` の後に `show()` をし、`updatePosition()` は非表示なら何もしない。meta で動かすなら、`show` の後に `updatePosition` を dispatch する（`docs/link-requirements.md` §5.5.11）。
- 一度も置かれていないカードは `left` / `top` を持たず文書の左上に付くので、中の input にフォーカスするとページ全体が先頭へスクロールする。`focus({ preventScroll: true })` と再配置の 2 か所で直す。
- ポータルにしたメニュー（`appendTo: document.body`）自身のボタンへの mousedown は、エディタを blur する。rAF 1 つ後に決まる「blur で隠す」規則が mousedown と mouseup の間にカードを消していた。述語はメニュー自身をフォーカスの置き場として数える（`document.activeElement?.closest('.link-bubble')`）。エディタ側は `view.hasFocus()` のままにする。`view.dom.contains(active)` にすると文書内の NodeView のボタンを誤って除外する。フォーカスがメニューのボタンにあるとエディタは既に blur しているので、そこから離れても blur は来ない。`focusout` の規則は表示モードでも走らせる（`docs/link-requirements.md` §5.5.9）。

### 10.5 バブルメニューが自分自身について測るものは、React の 1 描画ぶん古い

`@tiptap/core` の `dispatchTransaction` は `view.updateState`（つまりバブルメニューのプラグインの `updateHandler` → `show()` → `updatePosition()` → `getReferencedVirtualElement`）を、`'transaction'` を発火する前に走らせる。`@tiptap/react` の `useEditorState` はその発火で初めて `transactionNumber` を進める。位置決めの時点でポータルの子はまだ前の選択のもので、`menu.offsetWidth` は本物の、しかし誤った数字である（画像メニューで約 44px と約 151px。2026-09-07）。

**機構**: 判断を依存配列の無い `useLayoutEffect` で行う（毎回のコミットの後、描画の前に走る）。位置決めのコールバックは、描画が起きない唯一の経路（プラグインの `resizeHandler`。window の `resize` / `scroll`、60ms デバウンス）でだけ同じ関数を借りる。

- floating-ui の `top-end` は同じ理由で使えない（`reference.right - floating.width`）。自分に対する位置は CSS の `transform` で表す。`100%` は描画時の自分の箱に対して解決される。
- `@tiptap/react` の `syncClassName` は `element.className` を丸ごと代入する。命令的に切り替えたクラスが残るのは、React が子のレイアウト効果を親より先に走らせるからにすぎない。
- 画像 A から画像 B を選んでも再現しない。`show()` は表示中なら早期に戻り、メニューが空にならない。一度選択を外す。

## 11. ペーストとドロップのフック

### 11.1 選択を自分で置き換える `handlePaste` は、切り詰めて消す

Speaker Deck の貼り付け（`components/editor/speakerdeck-snippet-paste.ts`、`docs/embed-requirements.md` §16.9、基準 SD15 / SD16）で測った 4 つの罠。

- isolating の縁をまたぐ `deleteSelection()` はキャレットを囲みの中に残す（脚注定義の直前まで選んで消すと、キャレットは定義の中に止まり、ブロックを置けない）。`isolating-boundary.ts` の `deleteClampedSelection`（チェーンの `.command(props)` としてそのまま使える）を使い、false なら `commands.deleteSelection()` に落とす。
- `AllSelection` は自分の削除を生き延びる。空の文書の上に残り、`empty` が false なので、キャレット専用の述語は拒み続ける。`setTextSelection(tr.selection.from)` で畳む。
- `chain().run()` は、後のコマンドが false でもトランザクションを dispatch する（`@tiptap/core` の `createChain`）。失敗の分岐で `tr.setMeta('preventDispatch', true)` とすれば全体が落ちる。
- `editor.can().chain().deleteSelection().<place>()` ではこの手順を検証できない。`can()` の下では `buildProps` が `dispatch: undefined` を渡し、`deleteSelection` はトランザクションに触らず true を返す。本物のチェーンの中で配置コマンドに問い、取り消しは `preventDispatch` で行う。
- 計測の罠: Shift+矢印の選択は 20ms のデバウンスを経るので、同じティックの合成ペーストは古いキャレットに対して測られる（`settle` と `to > from` の assert。`e2e/editor-probe.ts` の `selectionSpan`）。拒否の経路の最終状態は、段階の削除が落ちても dispatch されても同じになる。文書を変えるトランザクションを数える（`countDocChanges`。ガード有りで 1、無しで 2）。

### 11.2 どのフックがどのジェスチャに届くか

- `transformPasted` はペースト専用ではない。`handleDrop` は、どの `handleDrop` の prop より先に `view.dragging.slice` にこれを適用する。そこで包みを外すと drop ガードが黙って無効になる。drop に触ってはいけない修復は `handlePaste`（+ `paste` / `uiEvent` の meta を付けた `replaceSelection`）で行う。
- `transformCopied` は両方のジェスチャを直す 1 か所に見える（prosemirror-view は `dragstart` で `view.dragging` をその結果から作る）が、届くのは行き先の側だけで、元の削除には届かない。
- prosemirror-view は `transformPasted` の prop をすべて走らせる（プラグインの順）。可換でない修復は手で合成する。
- `transformPasted` は `view.state.selection` がまだドラッグした範囲である間に走る。配置は、着地した後の自分の位置に問う（paste）か、`handleDrop` で問う（drop。行き先での修復は元が消えた後になるので、拒む）。

### 11.3 箱の中で作った選択はその箱を運ぶ — 現れるかは行き先で決まる

callout の中の文字は `Slice(callout(paragraph(…)), 2, 2)` で、平の段落の同じ文字は `Slice(paragraph, 1, 1)` である。テキストブロックへは開いた端が溶けて文字として着地し、ブロック位置（横の drop インジケータ）へは ProseMirror が開いたものを閉じて包みが本物のノードとして戻る。引用から出した文字が新しい引用の中に着地した。

**機構**: 入口でスライスを直す（`components/editor/slice-placement.ts` の `dropOpenWrappers`）。`openStart > 1 && openEnd > 1 && childCount === 1` で、唯一の子がテキストブロックでない間、包みの段を外す（最も内側のテキストブロックは残す）。以後「X を含む」と「X を置く」は同じ問いになる。

- 繰り返さない失敗: 述語の中で「置かれるか」に答える（`placedContent`）のは、テキストブロックの行き先には正しく、ブロックの行き先には誤りで、callout を引用の中に入れ子にするのを 1 日退行させた。
- 症状の形: 安全なほうのジェスチャが拒まれる。判定は着地点で決まるのに、述語はスライスしか見ていない。
- 設計の記録は `docs/accordion-requirements.md` §6.1・§6.2。

## 12. `.prose` の共有

`.prose` クラスは 4 つの面が身に付けている（エディタ `PostEditor.tsx`、公開ページ `app/posts/[slug]/page.tsx`、`FootnotePopover.tsx`、ブロックドラッグのゴースト `block-drag-handle.ts`）。

- 汎用の `.prose X` 規則の監査には 2 つの半分があり、飛ばされるのは 2 つ目である。「どの要素に届くか」だけでなく「どの既存の宣言に今や勝つか」。typography の `:where(a)`（0,1,0、レイヤ内）を `.prose a`（0,1,1、レイヤ外）で置き換えると、`.prose` の中の単一クラスの `color:` はすべて危うくなる。新しい要素向けの規則が奪えるのは、同じ要素を狙う規則からだけである。
- 色（`docs/link-requirements.md` §7.1）は共有することが目的なので `.prose a` に置く。`text-decoration` は足さない。`.footnote-popover-jump`（0,1,0）が `.prose a`（0,1,1）に負け、prose の下線が戻る。
- カーソルは共有が罠になる。`contenteditable` の中のリンクは既に I ビームを出すので、`openOnClick: false` は誤った手掛かりを作らない。公開ページ向けの汎用の `.prose a { cursor: pointer }` は、共有クラスを通じてエディタに誤誘導を持ち込む。カーソルの形は E2E で観測できない。範囲をエディタの外に絞る（アコーディオンの summary の前例: `.prose [data-type='details'] summary { cursor: text }`）。

### 12.1 静止時の下線は色で置き換えられない

2026-08-11 決定、再提案しない。静止時の下線を外すと、本文リンクは WCAG F73（SC 1.4.1、周りの文字との差が色だけで 3:1 未満）に入る。現在の比はライト 2.01、ダーク 2.10。

どの色でも直らない。

- ライトは、本文 zinc-700 に対して 3:1 には L ≥ 0.2516 が要り、白に対して 4.5:1 には L ≤ 0.1833 が要る。
- ダークは、本文 zinc-300 に対して L ≤ 0.1868、`#0a0a0a` に対して L ≥ 0.1887 が要る。
- どちらも窓が空である。本文が背景に対して 10.4:1 / 13.4:1 あり、2 つの制約の間に輝度の余地が無い。ダークで満たす唯一の方向は本文より暗いリンクで、リンクとしては逆向きに読める。
- 窓を開けるには本文の色を動かす必要がある（ライトは zinc-900 で 3.41。ダークは最低 zinc-200 で、合う青は `#0969da` の系統からシアン寄りにずれる）。

作者は比較した上で、恒久的な下線を残し、ホバー時の処理を何も足さないことを選んだ。`docs/link-requirements.md` §7.1 の「下線を外してはならない」の根拠はこの計算である。

## 13. React から editor に値を渡す

### 13.1 React の effect から `editor.view.dispatch` しない

steps が空で meta だけのトランザクションでも、すべてのプラグインの `appendTransaction` が走る。サムネイルの印をデコレーションに渡すために effect から dispatch したところ、`trailing-node-extension.ts` がそれに反応して追加し、`onUpdate` が発火した（TipTap は、追加分を含めてどのトランザクションも `docChanged` でない場合にしか `onUpdate` を抑えない）。`onUpdate` は無条件に `markEdited()` を呼ぶので、公開した直後の記事が「未公開の変更あり」に戻った（2026-09-07）。

**機構**: dispatch せず、`editor.storage` に書く。`link-card-extension.ts` の `ownSlug` と同じ形で、拡張は `addProseMirrorPlugins()` の中で `this.storage` を閉じ込めて読む。`@tiptap/react` の `useEditor` は描画のたびに `editor.setOptions(...)` → `view.updateState` を呼ぶので、デコレーションは PostEditor の描画ごとに問い直される。

- 同じコミットの `setOptions` より先に値を置く必要があるときは、layout effect で書く。React はすべての layout effect を passive effect より先に走らせ、`useEditor` の問い直しは passive である。
- その layout effect は `editorRef.current` ではなく `editor` を読む。`editorRef` は passive effect が埋めるので、`editor` が初めて存在するマウント時のコミットではまだ null である。依存が変わらない記事では書き込みが二度と起きず、保存済みのサムネイルが再読み込みで印を失った（2026-09-08、`docs/link-card-requirements.md` 基準 22p）。
- ref（あるいは ref を閉じ込めた `useCallback`）を `postEditorExtensions(...)` に渡すと、`react-hooks/refs` が描画中の ref アクセスとして弾く。`editor.storage` なら ref が介在しない。`useEditor` が返した値に `editor.storage… = x` と書くと `react-hooks/immutability` が弾くので、書き込みは effect の中で行う。
- この種のバグは `onUpdate` の `transaction` / `appendedTransactions`（steps、meta）を記録して調べる。`appendedTransactions[i].meta.appendedTransaction` に追加前の文書が入っている。

### 13.2 NodeSelection で出すバブルメニューの 2 つの prop

どちらも作者の報告から見つかり、測定した（2026-09-07、`docs/link-card-requirements.md` 基準 22e / 22f、`e2e/image-bubble-position.spec.ts`）。

- `updateDelay={0}` は必須である。`@tiptap/extension-bubble-menu` の `update()` は `updateDelay > 0 && hasValidSelection` でデバウンスの分岐に入り、NodeSelection は決して空でないので、既定の 250ms が表示そのものを遅らせる（クリックから表示まで 401ms → 92ms）。
- `placement` は幅に依存しないもの（`top-start`）にする。floating-ui は `-end` を `reference.right - floating.width` で解くのでメニューを測る。ポータルの子は 1 描画古い（§10.5）ので、幅が誤る。コミット後に位置を直す案は、effect から dispatch することになるので採らない（§13.1）。
- 古い計測で位置を決めたかどうかの判別: `window.dispatchEvent(new Event('resize'))` を投げる。プラグインの `resizeHandler` → `updatePosition()` が React のコミット後に走るので、メニューが動けば古い計測だった。

### 13.3 ポップアップの行は mousedown で既定を止め、click で実行する

行を mousedown で選ぶと一覧が同期的に閉じ、mouseup が下の文書に落ちてキャレットを置き、カードと未適用の編集も一緒に消えた（2026-08-18、リンクカードの見出し選択、`docs/link-requirements.md` §5.5.17）。`preventDefault()` は mousedown で要る。フォーカスが欄から離れるのを止めるためで、カードはそれを作者が離れたと読む（§10.4）。

**規則**: 起動で自分を外すポップアップの中の行やボタンは、`onMouseDown={(e) => e.preventDefault()}` + `onClick={act}`。2 つに分かれているのは事故に見えて「簡略化」されやすい。`SlashList.tsx` が mousedown で選んで問題ないのは、そのメニューがフォーカスの移動で消えるものの内側にないからである。

### 13.4 位置へのジャンプはスティッキーなツールバーの下に着地する

prosemirror-view の `scrollRectIntoView` は既定 5px の余白で最小限だけスクロールし、PostEditor のツールバーが `sticky top-0` でスクロール領域の上を覆っていることを知らない。見出しへ移動すると、見出しは y=5、ツールバーの下端は y=29 だった（2026-08-18、`docs/link-requirements.md` §5.5.18）。

- **機構**: 選択のトランザクションの後で要素自身を `element.scrollIntoView({ block: 'center' })` する。ツールバーの高さを `scrollMargin` の定数にしない（ボタンが 2 行に折り返した時点で古くなる）。ProseMirror は自前でスクロールするので CSS の `scroll-margin` も効かない。
- 逆向き: フォーカスだけを戻したいクロムも `editor.chain().focus()` でスクロールする。`@tiptap/core` の focus は既定で `scrollIntoView: true` で、NodeSelection では `delayedFocus` の分岐から rAF 内で `scrollIntoView()` を走らせ、ブロック全体の矩形を見せようとする。画像のサムネイルボタンで +87px 動いた（2026-09-08、基準 22o）。`focus(null, { scrollIntoView: false })` を使う。`view.focus()` 自体は `focusPreventScroll` を使う。
- spec は「スクロールしたか」ではなく「どこに着地したか」（ツールバーに隠れず、ビューポートの中）を測る。対象の前後に詰め物を置かないと、文書の先頭付近ではページが端で止まり、その止まり方を測ることになる。Playwright は大きな対象をクリックする前に自分でスクロールするので、ページを動かす前に対象を選んでおく。

## 14. 箱のスライス修復（callout / アコーディオン）

`callout-slice-guard.ts` と `details-slice-guard.ts` は `box-slice-repair.ts` を共有し、それぞれ仕様を述べて自分の配置規則だけを持つ（`16cece4`、2026-08-18）。4 つの引数（`nodeName`、`unwrap`、`depthDrop`、`recurseIntoRemoved`）と合成順の議論は `docs/accordion-requirements.md` §6.1・§6.2 にある。ここには計測の罠だけを置く。

- `Selection.content()` は `doc.slice(from, to, true)` である。3 つ目の引数 `includeParents` を落とした 2 引数の fixture は、これらのガードが何も言うことのない最小のスライスを作る。最初のテストは `dropOpenWrappers` を完全に外しても全ケース通っていた（AGENTS.md の「Slices come from a real selection」の由来）。
- `not.toContain('details(details')` は普通のアコーディオン（`details(detailsSummary(`）にも一致するので、正しい結果で落ちる。箱の数を数える。
- 2 つとも、テストスイートに対して意図的に変異を入れて見つけた。`slice-guard-composition.test.ts` は、引数ごとの変異に `nodeName` の入れ替えと早期 return の削除を加えた 7 つの変異をすべて捕まえる。
- 裸の `detailsSummary` は欠陥ではない（2026-08-18 に実ブラウザで測定、閉じた）。1 つのアコーディオンの中に留まる選択は `<details(detailsSummary("題名テ"))> (2,2)` をクリップボードに残すが、本物のブロック位置では fitter が置けない `detailsSummary` を `paragraph` に変える。5 つのジェスチャで文字の喪失も no-op も `pageerror` も無かった。
- Chrome はマウスのドラッグでタイトルから本文への選択を作らない（本文だけに正規化する）。その形には `setRange` でしか届かない。

## 15. フォームと React

### 15.1 PostEditor の `<form>` の中に `<form>` を置かない

PostEditor はタイトル・ツールバー・エディタ・公開ボタンを 1 つの `<form>` で包んでいる。入れ子の `<form>` は不正な HTML で、ブラウザは内側を黙って捨て、その送信は外側に向かう。症状は「送信しても何も起きない」と React の `<form> cannot be a descendant of <form>`。ツールバーの中のダイアログは `<div>` と `type='button'` の `onClick`（キーボード用に欄の `onKeyDown` の Enter）で作る。前例は `components/editor/TableGridMenu.tsx` の `TableSizeDialog`。

### 15.2 NodeView の中のフォーム部品は、公開のたびに表示値が消える

React 19 は `<form action={serverAction}>` の完了後にフォームをリセットし（`requestFormReset`）、所属する非制御の部品をすべて戻す。NodeView の中の `<input>` / `<select>` は表示値が空になる。ノードの属性は残り、トランザクションが起きないので NodeView の `sync()` も走らず、次の編集まで空のままになる。

**機構**: `form` 属性を存在しない id にして、部品をフォームから外す（所属先が無くなり、リセットも送信もされない）。コードブロックのファイル名と言語の欄がこの形である（`code-block-extension.ts` の `DETACHED_FORM_ID`）。

### 15.3 App Router では React のルートが `document` である

React の `event.stopPropagation()` は、`document` に登録したネイティブのリスナー（Escape で設定のドロワーを閉じる `useDismiss` など）を止められない。同じノードを共有しているからである。`event.nativeEvent.stopImmediatePropagation()` を使う。React のルートのリスナーはハイドレーション時に付き、どの effect より先なので、これで止まる（2026-09-23、`components/editor/TagField.tsx`）。

### 15.4 IME の spec は変異で確かめる

CDP の `Input.imeSetComposition` + `Input.dispatchKeyEvent` の Enter は `isComposing=true` で届く。ただしタグの combobox の spec は、合成した文字に一致する選択肢が非同期の「新しいタグを追加」行だけで、否定の assert が fetch の完了前に走り、ガードを消しても通っていた。合成する文字は同期的な選択肢（辞書にある行）に一致させ、誤って取られた Enter がすぐに見えるようにする。

### 15.5 proxy の Set-Cookie で、すべての Server Action がページを再検証する

`proxy.ts` は `/admin` へのリクエストごとにセッションの cookie を更新していた。Next は proxy の Set-Cookie を Server Action の cookie ストアにマージし（`next/dist/server/async-storage/request-store.js` の `mergeMiddlewareCookies`）、cookie が変わると `x-action-revalidated: 1` が付いて、応答がアドレスバーの URL のページ全体を運ぶ。PostEditor が `/admin/posts/new` から `/edit` に `replaceState` していたので、edit ページが差し込まれてエディタが再マウントし、拒否された公開のエラーが消えた（2026-09-21、Next 16.2）。

**機構**: proxy は `req.headers.has('next-action')` のとき更新を飛ばす（`docs/editor-requirements.md` §12.27）。Action の結果が消える、あるいはクライアントコンポーネントが Action の後に再マウントするときは、まず応答の `x-action-revalidated` を見る。修正後も、`/new` からの最初の公開が成功したときは再マウントする。

## 16. 保存されるデータ

### 16.1 本文は公開では CRLF、自動保存では LF で届く

公開・非公開は PostEditor の `<input type='hidden' name='body'>` から FormData で届き、HTML のフォーム送信の手順が値の改行をすべて CRLF に書き換える。自動保存は `app/api/drafts/route.ts` に JSON で届き、LF のまま残る（2026-08-05 に DB で確認）。

- これが `lib/footnotes.ts` の `incompleteFootnotes` を壊した。`'\n'` で分割すると最後以外の行末に `\r` が残り、定義の正規表現が一致しない。脚注が N 個あると N-1 個が空として公開を拒まれた。
- 新しい書き込みは `lib/posts-write.ts` の `normalizeNewlines()` で LF に揃える。修正前に公開した行は次の公開まで CRLF のままで、公開済みの記事の自動保存は `body` ではなく `draft_content` に書くので自然には直らない。**保存された本文を行で走査するコードは `/\r?\n/` で分割する。**
- 未監査: `lib/shiki-diff-line-transformer.ts` は `code.split('\n')` している。

### 16.2 `draft_content` の JSON 列の型は検証ではない

`posts.draft_content` は drizzle の `text(..., { mode: 'json' }).$type<DraftContent>()` である。`$type` は型の主張で、検証ではない。`DraftContent` にフィールドを足す前に保存された行はそのキーを持たず、tsc は何も言わず、実行時には文字列のはずの場所が `undefined` になる。

- 2026-08-15 に `thumbnail` を足したとき、下書きを持つ行の編集画面で `initial.thumbnail === undefined` になり、`ThumbnailField` の `value === ''` の分岐を外れて誤った表示になった。次の自動保存で直るので、テストもエラーも何も捕まえなかった。
- **機構**: 読み込みの境界で揃える。`lib/draft-content.ts` の `normalizeDraftContent` が既定値を埋める。`DraftContent` にフィールドを足したら、ここにも既定値を足す。`lib/posts.test.ts` の「does not flag a working copy that merely predates a field」がこの形を固定している。
- 通常の列は安全である。マイグレーションで SQL の `DEFAULT` が付く。

## 17. CSS とオーバーレイ

### 17.1 Popover API

脚注のプレビュー（`components/FootnotePopover.tsx`、`docs/footnote-popover-requirements.md`）を作るときに、使い捨てのプローブで測った（2026-08-09）。

- `popover="manual"` には light dismiss も Escape も無い。どちらも `auto` だけのものである。`manual` を選んだら Escape の `keydown` を自分で登録する。ホバーやフォーカスで出すものは WCAG SC 1.4.13（Dismissible）のためにそれが要り、無くても黙って失敗する。
- UA の `[popover]` の 3 つの宣言が、位置を決めるオーバーレイとぶつかる。`inset: 0` と `margin: auto`（ビューポートの中央に置く。`left` / `top` を自分で決めるなら両方上書きする）と `overflow: auto`。
- 隠す部分木がページの内容の複製なら、`aria-hidden` だけでは誤りである。複製がリンクを持つと、支援技術から隠した部分木の中にフォーカスできる要素ができる。`inert` なら両方の経路を閉じる。`pointer-events: none` は Tab キーには何も言わない。
- 読者が入れるホバーのオーバーレイには閉じる遅延が要る。きっかけと箱の間には隙間があり、ポインタは一瞬どちらの上にも無い。遅延 0 では箱が移動中に消え、原理的に届かない（SC 1.4.13 Hoverable）。
- popover の状態は `el.matches(':popover-open')` で測る。自分の状態は `toggle` のリスナーで合わせる。プラットフォームは自分の閉じる経路を通さずに `auto` の popover を閉じる。

### 17.2 中央の列の縁を動かさずに片側へ列を足す

中央寄せの本文の列（`mx-auto max-w-3xl`）の横に列（目次のレールなど）を足すとき、本文の左端を動かさない方法は代数では決まらない。

- 全体を `mx-auto max-w-[合計]` にすると、足した幅の半分だけ本文が動く。
- 両側に `minmax(1rem, 1fr)` の溝を対で置く 4 列のグリッドも同じだけ動く。2 つの `1fr` は、レールを引いた残りを分け合うからである。独立に分かれると仮定した代数で「正しい」と証明でき、`boundingBox()` の測定に否定された。
- **機構**: 左の溝をレールと独立に計算する。`grid-template-columns: calc((100% - <本文幅>) / 2) <本文幅> 1fr`。左の溝と本文は、単独の `mx-auto max-w-<本文幅>` の箱と同じ式になる。レールを `1fr` にすると 3 列の合計が常に 100% になり、はみ出しが起きないので、ブレークポイントは読みやすさだけで選べる（`docs/toc-requirements.md`）。
- 確かめ方は測定である。列がある状態と無い状態を複数のビューポート幅で描き、基準要素の `boundingBox().x` が一致することを assert する。

## 18. NodeView の `stopEvent`

- **`stopEvent` は操作部品（`input, button`）だけを主張する。** ラッパ全体を主張すると、NodeSelection を作る mousedown まで飲む（リンクカード、2026-08-12）。NodeView のボタンは選択を動かさないので、ボタンから呼ぶコマンドは `getPos()` の位置を明示的に受け取る（`unsetLinkCard` の `at`）。
- **`stopEvent` の主張は drop の経路の穴にもなる。** prosemirror-view の `eventBelongsToView` は、`stopEvent` が `event.target` を主張した時点で手を引くので、そこへの drop は ProseMirror の処理を通らず、ブラウザの既定がすべてになる。本文の文字をカードの検索欄にドラッグすると、文字が欄に入り、文書からは消えた（2026-08-22、`a8854cc`）。**機構**: `useDragContainment.ts` の `refuseChromeDrops` が、各 NodeView の `stopEvent` が主張するものと同じ範囲で dragenter / dragover / drop を拒む。`dom` 全体を拒んではいけない。カードの本体は普通のブロック位置で、drop カーソルが動き続ける必要がある。
- ProseMirror は、触れていないノードの NodeView を作り直さない。別の場所の打鍵や、同じ内容の `setContent` は古い DOM を残す。「描き直しても残る」を確かめるには、別の文書を読み込んでカードが消えたことを確かめてから、元に戻す。NodeView の結果のキャッシュは答え全体を持つ（題名だけのキャッシュは、作り直すたびに下書きの注記と画像を落とした）。
