# ADR-0021: Project は 1 画面のワークベンチで扱う

Status: Accepted
Date: 2026-09-19
Decider: Claude（Architect）。制作者が設計書 `docs/UI-WORKBENCH.md` を承認（2026-09-19）

## Context

Project 配下は 6 ページ（楽曲 / ストーリーボード / Shot 一覧 / タイムライン / 書き出し / 設定）
と Shot 詳細に分かれていた。Shot を 1 つ判断するたびに画面を移り、選択も再生位置も失う。
制作者は 2 ペインのモックで「1 画面で全部触れる」形を示した。

## Decision

1. **D1 ドッキング基盤は `dockview-react` を続投する。** ADR-0020 でストーリーボードに入れた
   ドックを Project 全体へ広げる。固定 3 ペインを自作しない
2. **D2 `/projects/[id]` をワークベンチにする。** 旧 URL 7 種は残し、ページ側の `redirect()` で
   ワークベンチの該当タブ・ダイアログへ送る（ID の検証を通すため `next.config` の redirects は使わない）
3. **D3 ワークベンチはサイト共通ヘッダと外周の余白を持たない。** Next の route group で
   `(site)` と `(workbench)` に殻を分ける。メニューバーが共通ヘッダの役目を引き取る
4. **D4 文字の尺度を全体で 1 段小さくし、rem で持つ。** ワークベンチ専用の尺度は作らない。
   根元の大きさ（15 / 16 / 18px）を環境設定で変えられる
5. **D5 ペイン間で共有する状態は「選択中の Shot・Shot 一覧・再生位置」の 3 つだけ。**
   それ以外は各パネルが自分で取る。裏のタブは mount されないので、開くまで取らない

楽曲 / 書き出し / 設定はページを廃止し、ワークベンチの上に出すモーダル（ネイティブ `<dialog>`）にする。
Project に依らない設定は環境設定ダイアログに集め、`localStorage` の 1 キーに保存する。

## Consequences

- ドメインと API は変わらない。変わるのは `apps/web` の並べ方と密度だけ
- 保存キーは `ixa:workbench-layout:v1:<projectId>`。旧 `ixa:storyboard-layout:v4` は読まない
- `storyboard-workspace.tsx` と `storyboard-layout.ts` は役目を終えて削除する
- 部品は Provider の関数経由でしか Shot を書き換えない。SSE の購読は Provider 1 箇所
