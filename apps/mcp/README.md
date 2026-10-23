# @ixa/mcp — AI エージェントが ixa で動画を作るための MCP サーバ

stdio で話す MCP サーバ。ixa の API（`pnpm dev` の API、既定 `http://127.0.0.1:3001`）を
自動化用の鍵（Bearer）で呼ぶ薄いクライアントで、曲作り → Shot 割り → 最初のコマ → 動画 → テロップ・ナレーション・歌詞・音 →
書き出しまでを 57 のツールで扱う（ADR-0049。エフェクトの 3 本は ADR-0050、サムネイルは ADR-0051、効果音は ADR-0052・ADR-0054、
最初のコマの履歴とやり直しは ADR-0055、Take のレビューは ADR-0057）。各ツールには危険度の印（読むだけ・書く・消す・費用・設定）があり、
MCP の annotations にも写している（ADR-0058）。印はツールのいちばん重い操作に合わせる。`action` で重さが変わるツール
（`edit_character` の `update` と `delete` など）は、AI エージェントの会話の確認では呼び出しごとの印（`riskOf`）で決める。

## 用意するもの

| env | 必須 | 内容 |
|---|---|---|
| `IXA_API_TOKEN` | ○ | 画面の「アクセス用の鍵」で発行した**自動化用の鍵**（ADR-0046）。設定ファイルに直に書かない |
| `IXA_WORKSPACE_ID` | ○ | web の `NEXT_PUBLIC_WORKSPACE_ID` と同じ値 |
| `IXA_API_URL` | | 既定 `http://127.0.0.1:3001` |
| `IXA_MCP_OUTPUT_DIR` | | 書き出した mp4 の置き場。既定 `~/Movies/ixa-mcp` |
| `IXA_AGENT_SESSION_ID` | | 画面の「AI エージェント」の会話から起こされたときだけ API が渡す（ADR-0058）。あると、確認の `approve`（CLI の `--permission-prompt-tool`）と `waive_confirmations` を足す。手で設定しない |
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

| 段 | ツール |
|---|---|
| 作品 | `ixa_status` · `set_ai` · `create_project` · `get_project` · `update_project` · `duplicate_project` · `import_from_project` |
| 曲 | `generate_music` · `upload_music` · `set_master_track` · `music_overview` |
| Shot | `plan_shots` · `edit_shots` · `restructure_shots` · `draft_storyboard` · `create_character` · `edit_character` · `create_location` · `edit_location` · `manage_brand_assets` |
| 絵 | `draw_start_frames` · `set_start_frame` · `list_start_frame_history` · `use_start_frame` · `retry_image` · `view` |
| Take | `generate_takes` · `import_take` · `list_takes` · `adopt_take` · `review_take` · `hide_takes` · `upscale_takes` · `wait` · `cancel_jobs` · `align_to_music` |
| テロップと声 | `add_telops` · `list_telops` · `edit_clips` · `remove_telops` · `set_narration` · `speak_narration` · `set_lyrics` |
| エフェクトと音 | `add_effects` · `list_effects` · `remove_effects` · `analyze_motion` · `suggest_sfx` · `generate_sfx` · `upload_sfx` · `list_sfx` · `remove_sfx` · `edit_audio` |
| 仕上げ | `export` · `export_thumbnail` |
| 履歴 | `list_edits` · `undo` |

画面の「AI エージェント」の会話から起こされたときだけ API が渡す（ADR-0058）。あると、確認の `approve`（CLI の `--permission-prompt-tool`）と `waive_confirmations` を足す。手で設定しない |
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
`draw_start_frames` · `set_start_frame` · `list_start_frame_history` · `use_start_frame` · `retry_image` · `view` · `generate_takes` · `list_takes` · `adopt_take` ·
`review_take` · `upscale_takes` · `wait` · `add_effects` · `list_effects` · `remove_effects` · `analyze_motion` · `suggest_sfx` · `generate_sfx` ·
`list_sfx` · `remove_sfx` · `export` · `export_thumbnail`

画面の「AI エージェント」の会話から起こされたときだけ、`approve`（実行の前の確認）と `waive_confirmations`（以後確認しない）の 2 本が加わる。

生成は手元の GPU で数分かかる。投げたら `wait`（`maxWaitSec` で必ず返る。終わっていなければもう一度呼ぶ）、
出来は `view` の画像で確かめてから `adopt_take` する。
エフェクト（フラッシュ・寄りのパンチ・揺れ・スピード線など）は型と強さを選んで `add_effects` で置く。文から絵を作らない。
効果音は手元の Stable Audio 3（または MOSS）が英語の説明から作る。映像は見ないので、鳴らす時刻（きっかけ）はエージェントが決める。
`suggest_sfx` がエフェクトとトランジションから案を出し、`generate_sfx` で作って効果音の段に置く（`wait` の `kind: "sfx"` で待つ）。
ナレーションは `set_narration` で台本と声を決め、`speak_narration` で声にする（声の AI は課金。`wait` の `kind: "voice"` で待つ）。

### まだ MCP でできないこと

API に口が無いので、画面で直す。

- シーケンス（章立て）を扱う（作る・Shot を入れ直す）
- Shot の台詞・ロックを後から直す（台詞は `restructure_shots` の `insert` で足すときだけ）
- Shot の並べ替え
- 画像のクリップ（ロゴなど）をタイムラインに置く

## 確かめる

```bash
pnpm --filter @ixa/mcp typecheck
pnpm --filter @ixa/mcp lint
pnpm --filter @ixa/mcp test
```
