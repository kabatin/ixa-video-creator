# @ixa/db

PostgreSQL 16 + Drizzle ORM（ADR-0007）。スキーマは `src/schema/*.ts`、マイグレーションは `drizzle/`。
テーブル一覧は `docs/ARCHITECTURE.md` §19、型の正は `@ixa/domain`。

## マイグレーション

```bash
# 1. スキーマ（src/schema/*.ts）を編集する
# 2. SQL マイグレーションを生成する（DB 接続不要）
pnpm --filter @ixa/db db:generate      # → drizzle/NNNN_*.sql が増える

# 3. 生成された SQL をレビューしてからコミットする

# 4. 適用する（DATABASE_URL が必要。ローカルは infra の Postgres）
pnpm infra:up
DATABASE_URL=postgresql://ixa:ixa_dev_password@127.0.0.1:5432/ixa pnpm --filter @ixa/db db:migrate
```

`.env` に `DATABASE_URL` があれば `pnpm db:generate` / `pnpm db:migrate`（ルート）でも同じ。

## 規約

- 主キーは ULID の `text`。時間は `double precision` の秒。タイムスタンプは `timestamptz`。
- `takes` は追記のみ。UPDATE してよいのは `review_status` / `human_verdict` だけ。
- 削除はソフトデリート（`deleted_at`）。リポジトリは生存行だけを返す。
- SQL はこのパッケージの中だけに書く。リポジトリは `@ixa/domain` の型を返す。
