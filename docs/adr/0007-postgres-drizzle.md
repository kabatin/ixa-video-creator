# ADR-0007: PostgreSQL + Drizzle ORM

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

spec.md §24 は PostgreSQL を想定。ORM の選択が実装エージェントの生産性を左右する。
本システムは `ShotGenerationSpec` や `MusicAnalysis` など、構造が固まりきらない JSON を多用する。

## Decision

**PostgreSQL 16 + Drizzle ORM** を採用する。

- スキーマは TypeScript で定義し、そこから SQL マイグレーションを生成する（`drizzle-kit`）。
- JSONB カラムには **zod スキーマで型付け**し、読み書き両方で検証する。
- `packages/db` がスキーマとリポジトリ実装を所有。**他パッケージは SQL を書かない。**
- リポジトリは `packages/domain` が定義する Port インターフェースを実装する。

## Alternatives considered

- **Prisma** — スキーマ言語は読みやすいが、編集後に `prisma generate` を忘れると
  型が古いまま通る。エージェント並列開発では事故りやすい。また JSONB の型付けが弱い。却下。
- **生 SQL + Kysely** — 制御は効くがボイラープレートが多い。却下。

## Consequences

+ 型定義が単一ソース。codegen 忘れによる不整合が起きない。
+ 生成された SQL マイグレーションをレビューできる。
− Drizzle のリレーション API は Prisma ほど宣言的でない。
  → リポジトリ層で吸収し、呼び出し側には Domain 型だけを見せる。
