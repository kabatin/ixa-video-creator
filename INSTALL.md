# INSTALL.md — エージェント向けの導入・点検・更新の手順書

> For AI agents (Claude Code / Codex) asked to install, check or update ixa on a Mac.
> Follow this file from top to bottom. Whenever it says **人に聞く (ask the human)**, stop, show the human the
> message and the suggested fix, and wait for their answer. Never print secret values.

人が手で入れるときも同じ手順でよい（`pnpm ixa setup` が全部やる）。決めたことは [ADR-0063](./docs/adr/0063-ixa-cli-setup-doctor-update.md)。

---

## 0. 守ること

**人に聞く所**（エージェントが勝手に進めない）:

| 場面 | なぜ |
|---|---|
| Homebrew で道具を入れる（`brew install ffmpeg` など）・Homebrew そのものを入れる | その Mac にソフトを入れる |
| Docker Desktop を入れる | 人の操作が要る（ダウンロードと許可） |
| 課金の鍵（`FAL_API_KEY`・`GEMINI_API_KEY`・`ELEVENLABS_API_KEY`）を入れる・`VIDEO_PROVIDER=fal`・`AUDIO_API_PROVIDERS` | お金が掛かる・原稿が外に出る |
| アクセス用の鍵（`IXA_API_TOKEN`）の発行 | **画面で制作者が押す。** エージェントは DB に直接作らない |
| 別の clone の DB を共有するか分けるか | 別の作品が混ざる |
| ポートを使っている別のプロセスを止める | 人の作業を止める |
| 未コミットの変更・自分のブランチがある clone を更新する | 人の変更を消しかねない |
| Claude Code / Codex の設定に MCP を書き込む（`--write`） | 人の設定を書き換える |

**しないこと**: 鍵の値を表示・ログ・チャットに出す／`IXA_API_TOKEN` をファイルに書く／`docker compose down -v`／
値の入った `.env` の行を書き換える（人に言われたときだけ）／`pnpm dev` を勝手に止める・起動し直す。

**機械で読むときは `pnpm -s ixa <コマンド> --json`**（`-s` が無いと pnpm の見出しが stdout に混ざる）。

---

## 1. 入れる

```bash
git clone https://github.com/kabatin/ixa-video-creator.git
cd ixa-video-creator
pnpm install
pnpm -s ixa setup --yes --json
```

- `node -v` が 22 未満、または `pnpm` が無いときは `pnpm install` の前に直す（下の「道具」）。
  pnpm は `corepack enable && corepack prepare pnpm@9.15.4 --activate` で入る（人に聞かなくてよい）。
- `setup` は何度実行しても壊れない。済んだ手順は `already`（済み）になる。
- `--yes` は途中の質問（Docker Desktop を起動するか）に「はい」で答える。人の同意が要る手順は飛ばして `needs_human` を返す。

## 2. 結果の読み方

`setup` の答え（`doctor` は `results` だけ）:

```jsonc
{
  "command": "setup",
  "ok": false,
  "steps": [{ "id": "tools.ffmpeg", "status": "needs_human", "message": "FFmpeg が入っていません",
              "fix": { "hint": "…", "command": "brew install ffmpeg", "needsHuman": true }, "docs": "INSTALL.md#道具" }],
  "results": [{ "id": "db.migrations", "group": "db", "level": "ok", "message": "…" }],
  "next": ["pnpm dev を起動して http://localhost:3000 を開く…"]
}
```

- `status`: `done`（やった）・`already`（済み）・`skipped`・`notice`（知らせるだけ）・`needs_human`（止まった。人に聞く）・`failed`（止まった）
- `level`: `ok` ✓・`warn` !・`fail` ✗・`skip` -（見なかった。理由は `message`）
- `fix.command` はそのまま打てる 1 行（リポジトリの直下で）。`fix.needsHuman: true` なら**打つ前に人に聞く**。

進め方:

1. `ok: true` なら「5. MCP の登録」へ。
2. 止まった手順（`needs_human` / `failed`）が 1 つ以上あれば、**上から 1 つずつ**直す。
   - `fix.needsHuman: true` → 人に `message` と `fix.hint`（と `fix.command`）を見せて、答えを待つ。
   - そうでなければ `fix.command` を打つ。無ければ `fix.hint` のとおりにする。
3. `pnpm -s ixa setup --yes --json` をもう一度。3 回回しても同じ所で止まるなら、そこまでを人に報告して止まる。

## 道具

| id | 直し方 | 人に聞く |
|---|---|---|
| `tools.node` | `brew install node@22`（22 以上） | はい |
| `tools.pnpm` | `corepack enable && corepack prepare pnpm@9.15.4 --activate` | いいえ |
| `tools.git` | `xcode-select --install` | はい |
| `tools.docker` | Docker Desktop を入れてもらう（下の「Docker」） | はい |
| `tools.docker-running` / `tools.docker-compose` | 下の「Docker」 | — |
| `tools.ffmpeg` / `tools.ffprobe` | `brew install ffmpeg` | はい |
| `tools.uv` | `brew install uv` | はい |
| `tools.audio-deps` | `uv sync --directory apps/audio`（Python 3.12 も uv が用意する） | いいえ |

Homebrew が無ければ、`brew` の 1 行の代わりに Homebrew（https://brew.sh）の入れ方を案内する。入れるのは人。

## Docker

- 入っていない → 人に Docker Desktop（https://www.docker.com/products/docker-desktop/）を入れてもらう。
- 止まっている → `open -a Docker` で起動して 1 分ほど待つ（`setup --yes` は自分で起動して待つ）。
- `infra` が `failed` → `docker logs <名前>-postgres` を見る。ポート（既定 5432・6379）がほかで使われていないか。

## 設定

- `.env` は `.env.example` から作られる。既定は**課金しない設定**（映像・絵・下書きは手元のスタブ）。
- 署名の鍵（`STORAGE_SIGNING_SECRET`）は setup が作って入れる。**値は表示しない。**
- `env.valid` が `fail` で `needsHuman` → 書いてある名前の組み合わせが成り立たない（例: `AUDIO_API_PROVIDERS` に書いたのに鍵が無い）。
  どちらに直すか人に聞く。
- `env.new-keys`（!）→ 新しい版で増えた項目。無くても既定で動く。`.env.example` の説明を読んで、要るものだけ足す（鍵は人に聞く）。
- `env.web-local`（!）→ `apps/web/.env.local` が直下の `.env` と違う値を持っている。消すか揃える。

## DB

- `db.*-container` が ✗ → `pnpm ixa setup`（Docker で起動する）。
- `db.migrations` が ✗ → `pnpm ixa setup`（まだの DB の更新を当てる）。
- `db.workspace` が ✗ → 空なら `pnpm ixa setup` が作って `.env` に書く。**`.env` の ID が DB に無い**ときは人に聞く（別の DB の ID かもしれない。setup は書き換えない）。

## 2 つ目の clone

同じ Mac で ixa がもう動いている（別の場所に clone がある）と、`.env.example` の既定のままでは**その clone の DB**
（`ixa-postgres`・5432）につながる。setup はそれを見つけると `infra` で `needs_human` で止まる。**どちらにするか人に聞く**:

- **分ける**（ふつうはこちら）: `.env` に書き、URL のポートも揃えてから setup をやり直す。
  ```bash
  IXA_COMPOSE_PROJECT=ixa2
  IXA_COMPOSE_PREFIX=ixa2
  POSTGRES_PORT=55432
  REDIS_PORT=56379
  DATABASE_URL=postgresql://ixa:ixa_dev_password@127.0.0.1:55432/ixa
  REDIS_URL=redis://127.0.0.1:56379
  ```
  dev も同時に動かすなら `API_PORT`・`NEXT_PUBLIC_API_URL`・`AUDIO_PORT`・`AUDIO_SERVICE_URL` も替える
  （web の 3000 は固定なので、同時には片方だけ）。
- **共有する**: `.env` に `IXA_COMPOSE_SHARED=true`。同じ作品・同じワークスペースを見る。

## 動いているもの

- `runtime.port-*` が ! → そのポートを別の場所の ixa の dev が使っている。この clone の dev は同時に起動できない。どうするか人に聞く。
- `runtime.port-*` が ✗ → ixa 以外が使っている。`lsof -nP -iTCP:<ポート> -sTCP:LISTEN` で確かめ、止めてよいか人に聞く。
- `runtime.*-health` が ✗ → dev は動いているが答えない。`pnpm dev` の出力のエラーを見る。

## 任意

- `optional.claude` / `optional.codex`（!）→ 無くても動く。AI エージェントのタブ・絵コンテの案・絵は Claude Code / Codex を使う。入れるかは人が決める。
- `optional.whisper-model`（-）→ 文字起こしのモデルは初めて使うときに取ってくる（約 500 MB）。失敗ではない。
- `optional.storage` → 素材の置き場（既定 `~/ixa-video-creator/storage`、`.env` の `STORAGE_DIR`）に書けるか・空き。
- `local-ai.*`（!）→ `.env` で有効にした手元の AI サーバー（vpipe・wan・klein・ace-step・sfx）に届かない。
  サーバは別のリポジトリ。起動は人に頼む。

## 5. MCP の登録

```bash
pnpm -s ixa mcp --claude    # Claude Code に登録する 1 行（claude mcp add …）
pnpm -s ixa mcp --codex     # Codex の ~/.codex/config.toml に足す節
```

- 出てきた 1 行を人に見せる。**実際に登録する（`--write` を付ける）のは人の許可を得てから**。
- アクセス用の鍵（`IXA_API_TOKEN`）は入らない。**制作者が画面で発行する**: `pnpm dev` を起動し、
  http://localhost:3000/access-keys で「自動化用の鍵」を作り、シェルの環境に置く（例 `~/.zshrc` に `export IXA_API_TOKEN=…`）。
  エージェントは鍵を DB に作らない・ファイルに書かない。

## 6. 終わり

```bash
pnpm -s ixa doctor --json
```

`ok: true`（✗ が 0）なら終わり。人に報告する:

- やったこと（`steps` の `done`）と、残っている ! のうち人が決めること（`fix.needsHuman`）
- 次の 1 手: `pnpm dev` → http://localhost:3000（曲を落とすところから）、MCP の登録の 1 行と鍵の発行の場所

`pnpm dev` は人が起動する（エージェントが起動するなら人に聞いてから。止めるときも同じ）。

## 更新

```bash
pnpm -s ixa update --check --json   # 新しいリリースがあるか（何もしない）
pnpm -s ixa update --json           # 最新のリリースへ（--main で main の先頭へ）
```

- 止まる条件（`needs_human`）: 未コミットの変更がある（`update.dirty`）／ main 以外にいる（`update.branch`）／
  動いているジョブがある（`update.active-jobs`）／ main がタグより先・枝分かれ（`update.fast-forward`）。どれも人に聞く。
  `--force` はジョブの確認だけを外す。**人の許可なしに付けない**。
- 中で起きること: `git fetch --tags` → タグへ fast-forward → `pnpm install --frozen-lockfile` →
  **新しい版の CLI** が `uv sync` → DB の更新 → 新しく増えた `.env` の項目の一覧（値は書かない）→ doctor。
- `update.new-keys`（`notice`）→ 新しい項目を人に伝える。`devRestartNeeded: true` → 「dev を起動し直してください」と伝える（勝手に止めない）。
- 変更点は `releaseNotes` の URL。
