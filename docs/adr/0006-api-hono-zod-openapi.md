# ADR-0006: API は Hono + zod（OpenAPI 自動生成）

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

API には 3 種類の入口が必要になる。
(1) Web UI からのアプリ API、(2) Provider からの webhook コールバック、(3) 大容量メディアのアップロード。
また実装エージェントが並列で route を書くため、「1 ファイルを開けば契約が全部わかる」形が望ましい。

## Decision

`apps/api` を **Hono + @hono/zod-openapi** で構築する。Next.js の Route Handler に API を同居させない。

- 1 route = 1 ファイル。zod スキーマ（request/response）とハンドラを同居させる。
  → 実装エージェントの File Ownership を route 単位で切れる。
- OpenAPI ドキュメントが自動生成される。
- Web からは Hono の型付き RPC クライアント（`hc`）で呼ぶ。手書きの API クライアントを作らない。
- アップロードは **S3 署名付き URL への直接 PUT**。API はファイル本体を経由しない。

## Alternatives considered

- **tRPC** — 型は最高だが webhook / OpenAPI / 非 TS クライアントが不自然になる。却下。
- **Next.js Route Handlers に集約** — Worker から同じロジックを呼びにくく、
  UI のデプロイと API のスケールが結合する。却下。

## Consequences

+ Worker / Python サービス / Provider webhook が同じ API を叩ける。
+ route ファイル単位で並列実装でき、コンフリクトが起きにくい。
− Next.js とは別プロセスになり、ローカル起動が 1 つ増える。
  → `pnpm dev` で並列起動して吸収する。
