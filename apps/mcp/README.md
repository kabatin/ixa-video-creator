# @ixa/mcp — AI エージェントが ixa で動画を作るための MCP サーバ

stdio で話す MCP サーバ。ixa の API（`pnpm dev` の API、既定 `http://127.0.0.1:3001`）を
自動化用の鍵（Bearer）で呼ぶ薄いクライアントで、曲作り → Shot 割り → 最初のコマ → 動画 → 書き出しまでを
21 のツールで扱う（ADR-0049）。

## 用意するもの

| env | 必須 | 内容 |
|---|---|---|
| `IXA_API_TOKEN` | ○ | 画面の「アクセス用の鍵」で発行した**自動化用の鍵**（ADR-0046）。設定ファイルに直に書かない |
| `IXA_WORKSPACE_ID` | ○ | web の `NEXT_PUBLIC_WORKSPACE_ID` と同じ値 |
| `IXA_API_URL` | | 既定 `http://127.0.0.1:3001` |
| `IXA_MCP_OUTPUT_DIR` | | 書き出した mp4 の置き場。既定 `~/Movies/ixa-mcp` |
| `LOG_LEVEL` | | 既定 `info`。ログは stderr に出る（stdout は MCP 専用） |

鍵はシェルの環境に置く（例: `~/.zshrc` に `export IXA_API_TOKEN=...`、またはキーチェーンから読む）。
`ffmpeg` / `ffprobe` が PATH にあること（`view` が使う）。

## Claude Code に登録する

プロジェクトの `.mcp.json`（鍵は `${...}` でシェルの環境から展開させる）:

```json
{
  "mcpServers": {
    "ixa": {
      "command": "/path/to/ixa-video-creator/apps/mcp/node_modules/.bin/tsx",
      "args": ["/path/to/ixa-video-creator/apps/mcp/src/main.ts"],
      "env": {
        "IXA_API_URL": "http://127.0.0.1:3001",
        "IXA_WORKSPACE_ID": "${IXA_WORKSPACE_ID}",
        "IXA_API_TOKEN": "${IXA_API_TOKEN}"
      }
    }
  }
}
```

`claude mcp add` で入れるなら、`-e IXA_API_TOKEN=...` は使わない（鍵がそのまま設定に書き込まれる）。
鍵はシェルの環境から引き継がせる:

```bash
claude mcp add ixa -e IXA_WORKSPACE_ID="$IXA_WORKSPACE_ID" -- \
  /path/to/ixa-video-creator/apps/mcp/node_modules/.bin/tsx \
  /path/to/ixa-video-creator/apps/mcp/src/main.ts
```

## Codex に登録する

`~/.codex/config.toml`（`env_vars` は名前だけを渡し、値はシェルの環境から引き継ぐ）:

```toml
[mcp_servers.ixa]
command = "/path/to/ixa-video-creator/apps/mcp/node_modules/.bin/tsx"
args = ["/path/to/ixa-video-creator/apps/mcp/src/main.ts"]
env_vars = ["IXA_API_TOKEN", "IXA_WORKSPACE_ID"]
startup_timeout_sec = 30
tool_timeout_sec = 960
```

`tool_timeout_sec` は `wait` / `export` の待ち（最長 900 秒）より長くする。

## 手で起動する

```bash
IXA_API_TOKEN=... IXA_WORKSPACE_ID=... pnpm --filter @ixa/mcp --silent start
```

## ツール

`ixa_status` · `set_ai` · `create_project` · `get_project` · `generate_music` · `upload_music` ·
`set_master_track` · `music_overview` · `plan_shots` · `edit_shots` · `create_character` · `create_location` ·
`draw_start_frames` · `set_start_frame` · `view` · `generate_takes` · `list_takes` · `adopt_take` ·
`upscale_takes` · `wait` · `export`

生成は手元の GPU で数分かかる。投げたら `wait`（`maxWaitSec` で必ず返る。終わっていなければもう一度呼ぶ）、
出来は `view` の画像で確かめてから `adopt_take` する。

## 確かめる

```bash
pnpm --filter @ixa/mcp typecheck
pnpm --filter @ixa/mcp lint
pnpm --filter @ixa/mcp test
```
