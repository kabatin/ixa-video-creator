# ADR-0027: プレビューの Shot は WebCodecs（`@remotion/media`）で描き、書き出しは OffthreadVideo のまま

Status: Accepted
Date: 2026-09-28
Decider: Claude（Architect）。制作者の報告（iPad Pro の Safari で、カットの境目に黒いコマが見える）

## Context

プレビューを通しで再生すると、Shot の境目に黒いコマが挟まった。

1. Player は `<Sequence>` が始まった瞬間に素材の読み込みを始めるので、境目ごとに 0.1〜0.2 秒黒が出た。
   → Shot とクリップを 1 秒前から組み立てる（`premountFor`）ことで、Chrome では消えた
2. それでも Safari（WebKit）では消えなかった。`<video>` 要素を Shot ごとに切り替える方式では、
   切り替わる瞬間に Remotion が次の動画を頭出しし、WebKit は頭出し中の動画を描かない。
   WebKit の録画で最長 9 コマ（約 0.4 秒）の黒を実測した。待機中の Shot を見える状態で裏に置く、
   前の Shot を残す、などの手当てでは、残す側も最後のコマへ頭出しで戻されて空白になり、消えきらなかった

## Decision

**プレビューの Shot は `@remotion/media` の `<Video>` で描く。** WebCodecs でコマをデコードし、
canvas に描く方式なので、`<video>` 要素の頭出しに頼らない。**書き出しは `<OffthreadVideo>` のまま**にする。

- 選び分けは `ShotVideo`（`packages/render/src/compositions/shot-video.tsx`）の 1 か所。
  `useRemotionEnvironment().isRendering` で決める。切り出し位置・速度・消音・contain は両方で同じ
- 合成は 1 つのまま（ADR-0010）。違うのはデコードの手段だけで、書き出しの絵は変わらない
  （画素のテストはそのまま通る）
- `@remotion/media` は素材を範囲指定で取りに行くので CORS が要る。MinIO は Range の許可と
  Content-Range の公開を返している（確認済み）。失敗したときは `<OffthreadVideo>` に自動で戻る
- Safari の WebCodecs は映像のみ対応。Shot は消音なので条件に合う
- VIDEO2 などのメディアのクリップは今のまま（`<OffthreadVideo>`）。同じ症状が出たら同じ形で寄せる

## Consequences

- 画面に描かれたコマを数える計測で、Chrome・WebKit とも境目の黒は 0 になった
- Playwright の WebKit では再生が実時間の半分ほどに落ちた（デコード待ち）。Chrome は実時間どおり。
  iPad の Safari はハードウェアでデコードするので同じにはならない見込みだが、ここでは確かめられない。
  実機で遅い場合は、Safari だけ `<video>` に戻す・先読みを長くする、を検討する
- `<video>` 方式向けに入れた手当て（待機中の Shot を見える状態で置く・前の Shot を残す）は外した。
  canvas では効かず、Safari では元から消えきらなかった
