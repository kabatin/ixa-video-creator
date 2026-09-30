# infra — ローカル開発インフラ

Postgres / Redis / MinIO をローカルで起動するための Docker Compose 定義。

## 前提

- リポジトリルートに `.env` を用意する（`.env.example` をコピー）。

```bash
cp .env.example .env
```

## 起動

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d
```

- Postgres: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- MinIO API: `127.0.0.1:9000`
- MinIO コンソール: `127.0.0.1:9001`（ブラウザで S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY でログイン）
- `minio-init` が起動時に一度だけ `ixa-media` バケットを作成する（既にあれば何もしない）
- MinIO のイメージは Chainguard 版（`cgr.dev/chainguard/minio`）。公式イメージの配布が止まったため（経緯は `docker-compose.yml` のコメント）

## 状態確認

```bash
docker compose --env-file .env -f infra/docker-compose.yml ps
```

## 停止

```bash
docker compose --env-file .env -f infra/docker-compose.yml down
```

## データを初期化（ボリュームごと削除）

```bash
docker compose --env-file .env -f infra/docker-compose.yml down -v
```
