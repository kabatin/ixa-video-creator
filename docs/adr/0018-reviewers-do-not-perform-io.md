# ADR-0018: 決定的レビュアは IO をしない

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

ADR-0005 で Review を決定的チェック層と LLM 判定層に分けた。
決定的チェック（technical / music / brand）は ffprobe の結果とフレームの見た目を使う。

素直に書くと、レビュア自身が動画をダウンロードして ffprobe を呼び、フレームを抜くことになる。
しかしそうすると、**判定ロジックの回帰テストに毎回 ffmpeg と実ファイルが要る**。

Phase 1〜2 で、実 ffmpeg を使うテストは遅く、負荷で揺らぐことが分かっている
（`@ixa/provider-video` のテストが原因不明で 1 度だけ落ちた件が未解決のまま残っている）。
判定の閾値は今後何度も調整するため、そこに重いテストがぶら下がるのは避けたい。

## Decision

**`packages/review` は IO をしない。** 測り終えた値を受け取る純粋関数だけを置く。

```
worker（IO あり）                     packages/review（純粋）
  原本をダウンロード
  probeMedia で尺・解像度・fps  ──┐
  ffmpeg でフレームの輝度と色  ──┼─► ReviewMeasurements ─► DeterministicReviewer
  MusicAnalysis を DB から引く ──┘                          └─► CreateReviewFindingInput[]
```

測定は `apps/worker/src/review/` が `@ixa/media` を使って行い、`ReviewMeasurements`
（`packages/review/src/port.ts`）に詰めて渡す。

同じ理由で、vision LLM 判定も `packages/providers/llm` のポートの背後に閉じ、
レビュー処理本体はポートの型だけに依存する。

## Consequences

+ 判定の回帰テストが**純粋なユニットテスト**になる。閾値の調整を恐れずに行える。
+ 同じ測定値なら必ず同じ指摘が出る。レビュー結果が再現する。
+ 測定（重い・環境依存）と判定（軽い・決定的）で、失敗したときの切り分けが付く。
− 測定側と判定側の型合わせが必要になる。`ReviewMeasurements` が両者の契約になる。
− フレームの色情報を「占有率の表」に落とす段階で情報が落ちる。
  MVP のブランドチェック（特定の色が一定割合あるか）には足りるが、
  ロゴの位置判定のようなものが必要になったら、この形を見直すこと。
