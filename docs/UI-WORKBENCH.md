# UI 組み換え設計書 — Project ワークベンチ

Status: Approved（制作者 2026-09-19）
Date: 2026-09-19
Architect: Claude

制作者が示したモック（2 ペイン案、2026-09-19）を実現するための設計。
**ドメインと API は変えない。** 変えるのは `apps/web` の画面の並べ方と密度だけ。

---

## 1. 目的

いまは Project 配下が 6 ページ（楽曲 / ストーリーボード / Shot 一覧 / タイムライン / 書き出し / 設定）
に分かれ、さらに Shot 詳細が別ページにある。Shot を 1 つ判断するたびに画面を移る。

これを **1 画面（ワークベンチ）** にまとめる。

- 左: 素材ツリー
- 中央上: ストーリーボード / プレビュー / Take 比較（タブ）
- 中央下: 聴きながら切る / タイムライン（タブ）
- 右: Shot 一覧 / インスペクター（タブ）
- 上: メニューバー、下: ステータスバー

モックの「01 構成をつくる」「02 映像を仕上げる」は**別画面ではなく、同じ配置でどのタブを前に出すかのプリセット**として扱う（§6）。

---

## 2. 決めたこと

| # | 決定 | 理由 |
|---|---|---|
| D1 | ドッキング基盤は既存の `dockview-react` を続投し、ストーリーボード用ドックを Project 全体へ広げる | ADR-0020 で入れた基盤で、タブ・分割・保存が揃っている。固定 3 ペインを自作しない |
| D2 | `/projects/[id]` をワークベンチにする。旧 URL は残し、ワークベンチの該当タブへリダイレクトする | 引き継ぎ文書・ブックマークを壊さない。深いリンクは `?` で表す（§7） |
| D3 | ワークベンチはサイト共通ヘッダと `px-6 py-6` を持たない。Next の route group で殻を分ける | メニューバーが共通ヘッダの役目を引き取る。周囲の余白は密度の敵 |
| D4 | 文字の尺度を **全体で** 1 段小さくする（§5）。ワークベンチだけの例外尺度は作らない。尺度は rem で持ち、根元の大きさを利用者が環境設定で変えられる | 尺度が 2 つあると部品を使い回せない。トークンは 1 箇所で決める（PHASE 5.9 の方針）。文字の大きさは好みが分かれるので、値を決め打ちせず 1 つのつまみにする |
| D5 | ペイン間で共有する状態は **選択中の Shot・Shot 一覧・再生位置** の 3 つだけ。それ以外は各パネルが自分で取る | いまも各部品が自分で取っている。共有を増やすほど一体化が難しくなる |
| D6 | ストーリーボードは中央にカードを **最大 3 列** で並べる。一覧は右ペインに任せる | 制作者の指示。中央は絵を大きく見る場所、右は探す場所 |
| D7 | プレビューは 1 枚、Take 比較は 2 枚（A/B）。それ以上並べない | 制作者の指示 |
| D8 | 楽曲 / 書き出し / 設定は**画面をほぼ覆うモーダルダイアログ**にする。背景はぼかす。ページは廃止し旧 URL は `?dialog=` へリダイレクト | 制作者の指示（2026-09-19）。頻度は低いがワークベンチを離れない。§3.3 |
| D9 | タイムラインのロック / 表示切替アイコンは今回は作らない | ドメインに無い状態。見た目だけ置くと押せないアイコンになる |
| D10 | Project に依らない設定は**環境設定ダイアログ**に集める。保存先は `localStorage`、制作データにしない | 制作者の指示（2026-09-19）。テーマ・音量は既に `localStorage` に散っている（`theme.ts`, `volume-preference.ts`）。1 箇所にまとめ、後から項目を足せる箱にする。§3.4 |

---

## 3. 画面の構成

```
┌ メニューバー (28px) ─────────────────────────────────────────────────────┐
│ iXA  ファイル  編集  表示  素材  Shot  生成  ヘルプ        [構成|仕上げ] ⚙ [書き出し] │
├ 素材 (240px) ─┬ 中央上 ─────────────────────────────┬ 右 (320px) ─────────┤
│ 🔍 検索       │ [ストーリーボード][プレビュー][Take比較]  │ [Shot一覧][インスペクター] │
│ + インポート  │                                      │                       │
│ ▾ プロジェクト │   ┌────┐ ┌────┐ ┌────┐               │ 27件  [すべて ▾]      │
│   楽曲・解析   │   │    │ │    │ │    │  ← 3 列       │ ☐ 01 ▣ CUT-01 0:07 ✓ │
│   絵コンテ案   │   └────┘ └────┘ └────┘               │ ☐ 02 ▣ CUT-02 0:08 ✓ │
│   書き出し履歴 │   CUT-01 0:00-0:07  説明…            │ ☑ 04 ▣ CUT-04 0:08 ● │
│ ▾ 共有素材     ├ 中央下 ─────────────────────────────┤ …                    │
│   キャラクター │ [聴きながら切る][タイムライン]         │                       │
│   ロケーション │ ▶ 0:18.42 / 1:56.04  ─────●─────  🔊 │                       │
│   ブランド資産 │ ▁▂▃▅▆▅▃▂▁ 波形 + 拍 + カット位置       │                       │
│ [サムネ 4×2]  │ [拡大][縮小] ☑拍に吸着  [Shotにする]   │                       │
├ ステータスバー (24px) ─────────────────────────────────────────────────────┤
│ ● ライブ接続   27 Shots   1920×1080・30fps   費用 $0.00 ⓘ                   │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.1 パネルと既存部品の対応

| ドック | パネル | 中身 | 既存部品 | 新規 |
|---|---|---|---|---|
| 中央上 | ストーリーボード | Shot カードの 3 列グリッド。ツールバーに「絵コンテ下書き…」 | `shot-poster`, `storyboard-draft-panel` | `storyboard-grid.tsx` |
| 中央上 | プレビュー | Program Monitor 1 枚 + トランスポート | `program-monitor`, `audio-transport` | — |
| 中央上 | Take 比較 | 選択中 Shot の A（採用）/ B（候補）と「この Take を採用」 | `take-compare-panel`, `take-compare`, `take-grid` | — |
| 中央上 | 絵コンテ下書き | いまと同じ（裏のタブ） | `storyboard-draft-panel` | — |
| 中央下 | 聴きながら切る | いまと同じ | `cut-editor` | — |
| 中央下 | タイムライン | いまと同じ。モニターは持たず、プレビューへ送る | `timeline-editor`（モニターを外す） | — |
| 右 | Shot 一覧 | 5 列の表 + 一括操作バー + フィルタ | `shot-table`（列を絞る）, `bulk-action-bar` | — |
| 右 | インスペクター | 選択中 Shot。タブ: 設定 / 生成 / レビュー | `storyboard-inspector`, `shot-summary`, `camera-fields`, `shot-cast-editor`, `shot-location-editor`, `generate-panel`, `review-panel`, `canonical-frame-panel` | `shot-inspector.tsx` |
| 左 | 素材 | ツリー + 選択中キャラクターのサムネイル | `identity-image-grid` | `asset-tree.tsx` |
| 上 | メニューバー | §4 | `theme-toggle`, `edit-history-panel`（元に戻す） | `menu-bar.tsx` |
| 下 | ステータスバー | ライブ接続・件数・解像度・費用 | `live-status-badge`, `cost-meter` | `status-bar.tsx` |

### 3.2 Shot 詳細ページの行き先

`/shots/[id]` の中身は全部ワークベンチに吸収する。

| 詳細ページの部品 | 行き先 |
|---|---|
| 採用中の Take・A/B 比較 | 中央上「Take 比較」 |
| Take 一覧（`take-grid`） | 「Take 比較」の下段。横スクロールのフィルムストリップ |
| サマリ・カメラ・登場人物・ロケーション | インスペクター「設定」 |
| 生成 | インスペクター「生成」 |
| レビュー | インスペクター「レビュー」 |
| 基準フレーム | インスペクター「設定」の末尾（折りたたみ） |

### 3.3 ダイアログ（楽曲 / 書き出し / 設定）

ワークベンチの上に **画面をほぼ覆うモーダル** として出す。ページは無くす。

| ダイアログ | 中身 | 既存部品 | 開き口 |
|---|---|---|---|
| 楽曲・解析 | 音源の登録、解析の開始と結果 | `music-panel`, `audio-uploader`, `analysis-starter` | ツリー「楽曲・解析」、メニュー 素材 → 楽曲… |
| 書き出し | 書き出しの設定と実行、指摘、履歴 | `render-panel`, `timeline-issue-panel`, `render-job-list` | 主ボタン「書き出し」、ファイル → 書き出し… |
| 設定 | プロジェクト設定 | `project-settings-form` | 歯車、ファイル → 設定… |

**作り**
- ネイティブ `<dialog>` + `showModal()`。焦点の閉じ込め、Esc、背景のスクロール止めがブラウザ側で付く。依存を足さない
- 大きさ: `w-[min(96vw,1400px)] h-[92vh]`。中は見出し行（題名 + 閉じる）と、自前でスクロールする本文
- 背景: `::backdrop { backdrop-filter: blur(8px); background: rgb(var(--bg) / 0.6) }`。ぼかしはトークン化しない（この 1 箇所だけ）
- 閉じ方: Esc / 閉じるボタン / 背景クリック。**保存前の入力があるときは背景クリックで閉じない**（設定フォームが対象）
- 開いている間もワークベンチは mount されたまま。閉じたら選択・再生位置はそのまま残る
- 楽曲の登録や解析の完了は SSE で Provider の状態へ届くので、閉じたときに取り直さない
- 殻は `components/workbench/workbench-dialog.tsx` 1 つ。3 つのダイアログはこれに中身を渡すだけ
- ライト / ダークはいまのまま維持する。殻も背景のぼかしも色トークン（`--bg` 等）だけを使い、素の色を書かない。Dockview の色接続 `.storyboard-dock` は `.workbench-dock` に改名して続投

### 3.4 環境設定ダイアログ（Project に依らない設定）

§3.3 と同じ殻。iXA メニュー → 環境設定…（⌘,）と、サイト側ページの歯車から開く。
左に分類、右に項目の 2 段。**分類を足せば項目が増やせる**のがこの箱の目的。

| 分類 | 項目 | 初期値 | 実体 |
|---|---|---|---|
| 表示 | テーマ | ダーク | `theme.ts`（既存）。ダーク / ライト |
| 表示 | 文字の大きさ | 標準 | 小 / 標準 / 大 = `html { font-size }` 15px / 16px / 18px。§5.1 の尺度が rem なので全部が一緒に伸縮する |
| 表示 | 画面の密度 | 標準 | 標準 / ゆったり = パネル内の余白 `p-2` / `p-3`（7.4） |
| 再生 | 音量・ミュート | 既存値 | `volume-preference.ts`（既存） |
| 再生 | 拍に吸着の既定 | ON | 聴きながら切る / タイムラインが開いたときの初期値 |
| ショートカット | 一覧（読むだけ） | — | `menu-model.ts` から生成。変更は 7.4 以降 |

**作り**
- `lib/preferences.ts` に zod スキーマと初期値。保存キー `ixa:preferences:v1`。壊れていたら初期値（lessons L-019 と同じく、最初の描画では読まない）
- `theme.ts` / `volume-preference.ts` の保存はこのモジュールへ寄せる。旧キー（`ixa.theme` 等）は最初の 1 回だけ読んで移し、消す
- 適用は `<html>` の属性と CSS 変数だけ（`data-theme`, `style="font-size"`）。部品は環境設定を直接読まない
- **入れないもの**: API キー・Provider の接続先。シークレットは env のみ（規約 6）

---

## 4. メニューバー

WAI-ARIA の Menubar パターンで自作する（依存を足さない）。← → でメニュー間、↑ ↓ で項目、Esc で閉じる。

| メニュー | 項目 | 実体 |
|---|---|---|
| iXA | プロジェクト一覧 / キャラクター / 素材ライブラリ / 環境設定… ⌘, | 既存の `SiteHeader` の行き先、環境設定ダイアログ（§3.4） |
| ファイル | 新規プロジェクト / 設定… / 書き出し… | 新規はページへ。設定・書き出しはダイアログ（§3.3） |
| 編集 | 元に戻す ⌘Z / やり直す ⇧⌘Z / 変更履歴… ⌘Y | 元に戻す = `edit-history` の Undo。**やり直すは無効表示**（実装が無い。モックでも灰色） |
| 表示 | ストーリーボード / プレビュー / Take 比較 / 聴きながら切る / タイムライン / Shot 一覧 / インスペクター / パネル配置をリセット | 対応するパネルを前に出す（`api.getPanel(id).api.setActive()`） |
| 素材 | 素材をインポート… / 楽曲… | `image-uploader`、楽曲ダイアログ（§3.3） |
| Shot | 新規 Shot / 選択を一括変更… / 選択を削除 | `shot-form`, `bulk-action-bar` |
| 生成 | 選択した Shot を生成 / 一括生成… | `generate-panel`, `bulk-action-forms` |
| ヘルプ | キーボードショートカット | 既存の `help-disclosure` の内容 |

右端: 作業モード（構成 / 仕上げ、§6）、歯車（→ プロジェクト設定ダイアログ。環境設定は iXA メニュー）、主ボタン「書き出し」（→ 書き出しダイアログ）。

メニューの中身は `lib/menu-model.ts` に**データとして**持つ（`{ label, shortcut, enabled, run }`）。
「有効かどうか」（選択が無ければ削除は無効、履歴が無ければ元に戻すは無効）は
このモジュールの純粋関数で決め、ユニットテストで固定する。

---

## 5. 密度

モックの文字はいまの画面より 1 段小さい。**尺度そのものを変える**（D4）。

### 5.1 文字（`tailwind.config.ts` の `fontSize`）

値は **rem** で持つ（根元 16px のときの px を併記）。根元は環境設定の「文字の大きさ」が動かす（§3.4）。

| クラス | いま | 変更後 | 主な用途 |
|---|---|---|---|
| `text-xs` | 12px | **0.6875rem（11px）/ 1rem** | 表のセル、時刻、補足 |
| `text-sm` | 14px | **0.75rem（12px）/ 1.125rem** | 本文、ボタン、入力欄、タブ |
| `text-base` | 16px | **0.8125rem（13px）/ 1.25rem** | パネル見出し |
| `text-lg` | 18px | **0.9375rem（15px）/ 1.375rem** | ページ見出し（プロジェクト一覧・キャラクターなど）・ダイアログの題名 |
| `text-2xl` | 24px | **1.25rem（20px）/ 1.75rem** | プロジェクト一覧の見出し |

既存の `text-[10px]` / `text-[11px]` は `text-xs` に寄せ、素の px を消す。

**守ること（`globals.css` の規則をそのまま）**
- コントラスト 4.5:1。`muted` は 11px でも `surface` 上で 7.6:1 なので使える
- `faint` は **12px 未満では使わない** → `text-xs` と `faint` の組み合わせは lint で落とす（`eslint-plugin-tailwindcss` が無ければ簡単な grep テストでよい）

### 5.2 高さと余白

高さも rem で持つ（px は根元 16px のとき）。文字を大きくしたら行も一緒に伸びる。

| 部位 | 値 |
|---|---|
| メニューバー | 1.75rem（28px） |
| ドックのタブ列 | 1.75rem（`--dv-tabs-and-actions-container-height`） |
| パネル内ツールバー | 2rem（32px） |
| 表の行 | 1.5rem（24px） |
| ステータスバー | 1.5rem（24px） |
| パネル内の余白 | `p-2`（いまの `p-3` / `p-6` をやめる） |
| アイコン | 0.875rem（14px） |

**押せる領域は 24×24px を下回らない**（WCAG 2.5.8）。文字を小さくしても、ボタンの `min-h` と行の高さで確保する。

### 5.3 ストーリーボードのカード

- 中央上の幅で列数を決める。**画面幅ではなく、割り当てられた区画の幅**（lessons L-025）→ CSS container query（`@container`）
- 区画 ≥ 720px: 3 列、≥ 480px: 2 列、それ未満: 1 列。**4 列にはしない**（D6）
- カード: サムネイル 16:9、右上に状態の点（`shot-status-badge` の色）、`CUT-04  0:22-0:30 (0:08)`、説明 1 行（省略）、`continuityMode === 'previous_shot'` なら鎖のアイコン
- 選択中: `ring-2 ring-accent`

1440×900 では左 240 + 右 320 を引いた中央 ≈ 880px → 3 列・1 枚 ≈ 280px。1920 では ≈ 450px。

---

## 6. 作業モード（プリセット）

同じ配置で、前に出すタブだけ変える。パネルの位置・大きさは動かさない。

| モード | 中央上 | 中央下 | 右 |
|---|---|---|---|
| 構成をつくる | ストーリーボード | 聴きながら切る | Shot 一覧 |
| 映像を仕上げる | Take 比較 | タイムライン | インスペクター |

プリセットは `lib/workbench-layout.ts` の純粋関数 `applyPreset(api, preset)` が `setActive()` を呼ぶだけ。
配置の JSON には手を入れない。

---

## 7. URL と状態

### 7.1 URL

```
/projects/[id]                       ワークベンチ（既定: 構成モード、先頭 Shot を選択）
/projects/[id]?shot=<ShotId>         その Shot を選択して開く
/projects/[id]?main=compare          中央上のタブを指定（storyboard | preview | compare）
/projects/[id]?bottom=timeline       中央下のタブを指定（cutter | timeline）
/projects/[id]?side=inspector        右のタブを指定（shots | inspector）
/projects/[id]?dialog=render         ダイアログを開いた状態で開く（music | render | settings）
```

旧 URL は `next.config` の `redirects` ではなく **ページ側で `redirect()`** する（ID の検証を通すため）。

| 旧 | 新 |
|---|---|
| `/projects/[id]/storyboard` | `/projects/[id]?main=storyboard&bottom=cutter` |
| `/projects/[id]/shots` | `/projects/[id]?side=shots` |
| `/projects/[id]/timeline` | `/projects/[id]?bottom=timeline` |
| `/shots/[id]` | `/projects/[projectId]?shot=[id]&main=compare&side=inspector` |
| `/projects/[id]/music` | `/projects/[id]?dialog=music` |
| `/projects/[id]/render` | `/projects/[id]?dialog=render` |
| `/projects/[id]/settings` | `/projects/[id]?dialog=settings` |

`?` はワークベンチを開くときに一度読むだけ。開いた後の操作で URL は書き換えない
（履歴が操作のたびに増えるのを避ける。共有したいときは「表示 → リンクをコピー」で現在値から作る。7.4）。

### 7.2 共有状態（D5）

```ts
type WorkbenchState = {
  readonly shots: readonly Shot[]              // SSE (`useProjectEvents`) で更新
  readonly posters: ShotPosterMap
  readonly selectedShotId: ShotId | null
  readonly transport: {                        // 7.2 で統合。7.1 では各部品が持ったまま
    readonly currentSec: number
    readonly playing: boolean
  }
}
```

- `WorkbenchProvider`（client）が持ち、`useWorkbench()` で各パネルが読む。いまの `StoryboardWorkspace` の Context を Project 全体へ広げた形
- Shot の更新は **必ず Provider の関数経由**（`saveShot`, `applyAdoptedShots`, `replaceShot`）。パネルが勝手に `setShots` しない
- SSE の購読は Provider 1 箇所。いま `shot-list-workspace` にある `useProjectEvents` をここへ移す
- 選択の連動: カードをクリック → `selectedShotId` → インスペクターが切り替わる、Shot 一覧の行が強調、Take 比較が取り直す、タイムラインのクリップが強調（7.2）

### 7.3 データの読み方

`app/(workbench)/projects/[id]/page.tsx`（server）が **共通の材料だけ** 一度に読む:
project、shots、tracks（`pickMasterTrack`）、analysis、sequences、locations。

それ以外（タイムライン文書、Take、比較結果、履歴、費用、下書き、ポスター）は
**いまと同じくパネルが自分で取る**。裏のタブは mount されないので、開くまで取らない。

失敗は畳まない（lessons L-015）。読めなかった部分は `loadErrors` としてステータスバーに出し、
読めた部分でワークベンチを開く。

---

## 8. ファイル構成

```
apps/web/src/
  app/
    (site)/                       ← 既存ページを移す。layout に SiteHeader + px-6 py-6
      layout.tsx
      page.tsx, characters/, library/, projects/new/
    (workbench)/
      layout.tsx                  ← ヘッダ無し・余白無し・h-screen
      projects/[id]/page.tsx      ← 共通材料を読み、<ProjectWorkbench> を出す
    projects/[id]/{storyboard,shots,timeline,music,render,settings}/page.tsx   ← redirect() だけ
    shots/[id]/page.tsx                                  ← redirect() だけ
  components/workbench/
    project-workbench.tsx         ← Provider + Dockview + 狭い画面の縦一列
    workbench-context.ts
    menu-bar.tsx
    status-bar.tsx
    workbench-dialog.tsx          ← <dialog> の殻。ぼかし背景・閉じ方・焦点
    dialogs/                      ← music-dialog.tsx, render-dialog.tsx, settings-dialog.tsx, preferences-dialog.tsx
    asset-tree.tsx
    storyboard-grid.tsx
    shot-inspector.tsx
    panels/                       ← Dockview に渡す薄い殻。1 ファイル 1 パネル、各 30 行程度
      storyboard-panel.tsx, preview-panel.tsx, compare-panel.tsx, cutter-panel.tsx,
      timeline-panel.tsx, shot-list-panel.tsx, inspector-panel.tsx, assets-panel.tsx
  lib/
    workbench-layout.ts           ← 既定配置・プリセット・保存（storyboard-layout.ts を一般化して置き換え）
    workbench-url.ts              ← ?shot / ?main / ?bottom / ?side / ?dialog の parse（zod）
    menu-model.ts                 ← メニュー項目と有効判定
    preferences.ts                ← 環境設定のスキーマ・初期値・保存・旧キーの移行（theme.ts / volume-preference.ts を吸収）
```

`storyboard-workspace.tsx` と `storyboard-layout.ts` は 7.1 で役目を終え、削除する。
保存キーは `ixa:workbench-layout:v1:<projectId>`。旧 `ixa:storyboard-layout:v4` は読まない。

---

## 9. 段階

各段は「typecheck / lint / test が緑」「1440×900 と 1920×1080 の実機で確認」を満たしてから次へ。

### 7.1 骨組み（一番大きい段）

- route group の分離、密度の尺度変更（§5）、旧 URL のリダイレクト
- `ProjectWorkbench` + 既定配置 + 保存 + リセット
- メニューバー（リンク項目と「元に戻す」のみ）、ステータスバー
- ストーリーボードのグリッド、プレビュー、Take 比較、聴きながら切る、タイムライン、Shot 一覧、インスペクター（設定タブのみ）を**既存部品のまま**載せる
- 左ペインはツリーの骨だけ（共有素材の項目は既存ページへのリンク）
- 楽曲 / 書き出し / 設定のダイアログ（§3.3）。中身は既存部品のまま
- 環境設定ダイアログ（§3.4）。7.1 ではテーマと文字の大きさだけ。密度・拍吸着の既定・ショートカット一覧は 7.4
- 選択の連動: カード ↔ 一覧 ↔ インスペクター ↔ Take 比較

**Acceptance**
- ストーリーボード・Shot 一覧・タイムライン・Shot 詳細の 4 ページで出来ていた操作が、ページ移動なしで全部できる
- 旧 URL 7 種が正しいタブ・Shot・ダイアログで開く
- 書き出しダイアログを開いたまま書き出しが完了し、閉じてもワークベンチの選択が残っている
- 環境設定で文字を「大」にすると表の行・タブ・メニューが一緒に伸び、再読み込み後も残る。ライト / ダークがワークベンチ・ダイアログ・Dockview の全部で切り替わる
- 配置を動かして再読み込みしても戻る。壊れた保存値では既定配置で開き、その旨が出る
- 1440×900 で中央上に 3 列、右ペインに 12 行以上が見える
- `text-[10px]` / `text-[11px]` が残っていない（grep テスト）

### 7.2 一体化

- 再生位置の統合: 聴きながら切る / プレビュー / タイムラインが 1 つの `transport` を共有する。`cut-editor`（621 行）と `timeline-editor`（671 行）がそれぞれ持つ再生状態を Provider へ寄せる。**この段だけは両部品の差分を実機で聴き比べる**
- タイムラインのクリップ選択 ↔ Shot 選択の双方向連動
- インスペクターの生成 / レビュータブ
- 作業モードのプリセット（§6）
- キーボード: ⌘Z / ⌘Y / Space（再生）/ ← →（Shot の移動）

### 7.3 素材ペイン

- ツリーの中身: キャラクター（識別画像・Look）、ロケーション、ブランド資産をその場で開く（中央上のタブとして `character-workbench`, `location-manager`, `brand-asset-manager` を出す）
- 検索欄、インポート
- 選択中キャラクターのサムネイル 4×2

### 7.4 磨き

- 「表示 → リンクをコピー」
- 空状態（楽曲なし・解析なし・Shot なし）をワークベンチの中で案内する。楽曲なしは中央上に「楽曲を登録」→ 楽曲ダイアログを開く（いまは `ErrorPanel` / `AnalysisStarter` がページを占有）
- 1024px 未満の縦一列

---

## 10. テスト

| 対象 | 種類 | 内容 |
|---|---|---|
| `workbench-url.ts` | unit | 不正な `?shot` は無視して既定へ。`main` の未知の値は `storyboard` |
| `workbench-layout.ts` | unit | 既定配置の JSON に 8 パネルが全部ある。プリセットが `setActive` を呼ぶ相手 |
| `menu-model.ts` | unit | 選択なしで削除が無効、履歴なしで元に戻すが無効、やり直すは常に無効 |
| `menu-bar.tsx` | component | ← → ↑ ↓ Esc の操作、`aria-expanded` |
| `storyboard-grid.tsx` | component | 区画の幅 720 / 480 / 400 で列数（L-025: viewport ではなく container） |
| `status-bar.tsx` | component | `loadErrors` が 1 件でもあれば必ず表示 |
| `workbench-dialog.tsx` | component | 開くと焦点が中に入る、Esc で閉じる、未保存の入力があると背景クリックで閉じない、閉じたら焦点が開き口へ戻る |
| `preferences.ts` | unit | 壊れた保存値は初期値。旧キー `ixa.theme` があれば移して消す。未知の分類は無視して残りを読む |
| 密度 | test | `apps/web/src` に `h-[..px]` / `text-[..px]` が無い（rem か Tailwind の尺度だけ） |
| 密度 | test | `apps/web/src` に `text-[..px]` が無い。`text-xs` と `text-faint` が同じ要素に無い |
| 縦切り | E2E | 開く → CUT-04 のカードを押す → インスペクターが CUT-04 → Take 比較で B を採用 → 右の一覧の状態が再読み込みなしで「採用」になる |

ドメインのテストは増えない（触らないため）。**壊して落ちるか**を各テストで一度確かめる（L-026〜L-029）。

---

## 11. 変えないこと

- `packages/*` と `apps/api`。新しいエンドポイントは要らない（必要になったら BLOCKED で止める）
- 規約 7（署名付き URL を持ち回さない）: 比較結果の `document` は Take 比較パネルの中で使い切る。Provider の共有状態に入れない
- 色トークンとライト / ダークの仕組み（`data-theme` + `globals.css` の表）。密度の変更は大きさだけで、色と役割名は動かさない
- Dockview の配置は `localStorage`（ADR-0020）

---

## 12. リスク

| リスク | 手当て |
|---|---|
| `cut-editor` と `timeline-editor` の再生統合で片方の挙動が変わる | 7.1 では触らない。7.2 で分離し、実機で聴き比べる |
| 尺度変更が既存ページ（プロジェクト一覧・キャラクター・素材ライブラリ）とダイアログの見た目を崩す | 7.1 の実機確認に全ページを含める。崩れた箇所は `text-lg` へ 1 段上げるだけで直す |
| 右ペイン 320px で `shot-table` の列が入らない | 列を 5 つに絞る。説明・mood の編集はインスペクターへ。一括操作バーは折り返す |
| Dockview の入れ子（左・中央上下・右）が既定 JSON で意図どおりに並ばない | `addPanel` の順序を `workbench-layout.ts` に固定し、ユニットテストで JSON を検査 |
| 1 画面に全部載せて初回が重い | 裏のタブは mount されない。共通材料は 6 種だけ（§7.3） |
| `backdrop-filter` のぼかしが Remotion Player の描画中に重い | ダイアログを開いている間はプレビューの再生を止める（`transport.playing = false`）。それでも重ければぼかしを 4px に落とす |
| ページを消して到達できない機能が生まれる | `project-links.ts` / `SiteHeader` の方針どおり、行き先を `menu-model.ts` の 1 箇所に集め、E2E で全項目を踏む |

---

## 13. 承認後にすること

1. ADR-0021「Project は 1 画面のワークベンチで扱う」を書く（D1〜D5）
2. Phase 7.1〜7.4 の契約・Acceptance・Ownership を起こす
3. 7.1 から着手
