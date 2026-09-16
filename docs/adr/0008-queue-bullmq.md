# ADR-0008: ジョブキューは BullMQ（Redis）

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

生成・レビュー・メディア処理・レンダリングはすべて長時間の非同期処理である。
外部 Provider にはレート制限と同時実行制限があり、キュー側で制御する必要がある。
レンダリングは 1 ジョブで数分〜数十分かかる。

## Decision

**BullMQ + Redis** を採用し、キューを性質ごとに分離する。

| キュー | 並列度 | 内容 |
|---|---|---|
| `media` | 高 | ffprobe / プロキシ生成 / サムネイル / フレーム抽出 |
| `generation` | Provider ごとに制限 | 動画・画像生成の submit と poll |
| `review` | 中 | 決定的チェック + LLM レビュー |
| `render` | 1〜2 | Remotion レンダリング（CPU を占有する） |
| `analysis` | 低 | 音楽解析（Python サービスへの委譲） |

- Provider のレート制限は **キューごとの limiter** と **グループ並列制限**で表現する。
- 外部ジョブのポーリングは repeatable job ではなく、**指数バックオフ付きの再スケジュール**で行う。
- すべてのジョブは冪等に書く。`GenerationJob` / `RenderJob` の DB 行が真実であり、
  キューは実行手段にすぎない。再起動でジョブが消えても DB から復元できること。

## Consequences

+ レンダリングの重い処理が生成ジョブを詰まらせない。
+ Provider ごとのレート制限を宣言的に書ける。
+ Redis は将来のリアルタイム通知（進捗 pub/sub）にも使える。
− Redis の運用が増える。
  → ローカルは docker compose、本番はマネージド Redis で吸収する。
