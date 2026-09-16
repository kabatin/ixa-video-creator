# ADR-0001: TypeScript モノレポ + Python は音楽解析のみ

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

spec.md §24 は Backend を TypeScript または FastAPI/Python としている。
一方で本システムは Remotion（React/TS）でモーショングラフィックスとレンダリングを行い、
Web UI も Next.js（TS）である。音楽解析だけは実用ライブラリが Python に集中している
（librosa / madmom / allin1）。

## Decision

- **既定言語は TypeScript。** apps/web, apps/api, apps/worker, packages/* はすべて TS。
- **Python は `apps/audio` の音楽解析サービス 1 つだけに閉じる。** HTTP で JSON を返す境界とし、
  結果は `MusicAnalysis` として TS 側が所有する。
- パッケージマネージャは **pnpm workspaces**、ビルドオーケストレーションは **Turborepo**。

## Consequences

+ ドメイン型・zod スキーマ・タイムライン計算を UI / API / Worker / Remotion で共有できる。
+ Remotion のコンポジションが Timeline のドメイン型を直接受け取れる（変換層が不要）。
+ 実装エージェントが 1 言語だけ意識すればよく、並列実装の事故が減る。
− Python サービスの運用（Docker イメージ、依存管理）が別系統になる。
  → 影響範囲を音楽解析だけに限定し、契約を JSON 1 本に絞ることで受け入れる。
