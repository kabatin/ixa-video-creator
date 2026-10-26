# @ixa/mcp — AI エージェントが ixa で動画を作るための MCP サーバ

stdio で話す MCP サーバ。ixa の API（`pnpm dev` の API、既定 `http://127.0.0.1:3001`）を
自動化用の鍵（Bearer）で呼ぶ薄いクライアントで、曲作り → Shot 割り → 最初のコマ → 動画 → テロップ・ナレーション・歌詞・音 →
書き出しまでを 58 のツールで扱う（ADR-0049。エフェクトの 3 本は ADR-0050、サムネイルは ADR-0051、効果音は ADR-0052・ADR-0054、
最初のコマの履歴とやり直しは ADR-0055、Take のレビューは ADR-0057、会話劇のセリフ・Take の音・2 段字幕は ADR-0059〜0061）。各ツールには危険度の印（読むだけ・書く・消す・費用・設定）があり、
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
| 絵 | `draw_start_frames` · `set_start_frame` · `set_end_frame` · `list_start_frame_history` · `use_start_frame` · `retry_image` · `view` |
| Take | `generate_takes` · `import_take` · `list_takes` · `adopt_take` · `review_take` · `hide_takes` · `upscale_takes` · `wait` · `cancel_jobs` · `align_to_music` |
| テロップと声 | `add_telops` · `list_telops` · `edit_clips` · `remove_telops` · `set_narration` · `speak_narration` · `set_lyrics` |
| エフェクトと音 | `add_effects` · `list_effects` · `remove_effects` · `analyze_motion` · `suggest_sfx` · `generate_sfx` · `upload_sfx` · `list_sfx` · `remove_sfx` · `edit_audio` |
| 仕上げ | `export` · `export_thumbnail` |
| 履歴 | `list_edits` · `undo` |

画面の「AI エージェント」の会話から起こされたときだけ、`approve`（実行の前の確認）と `waive_confirmations`（以後確認しない）の 2 本が加わる。

生成は手元の GPU で数分かかる。投げたら `wait`（`maxWaitSec` で必ず返る。終わっていなければもう一度呼ぶ）、
出来は `view` の画像で確かめてから `adopt_take` する。
エフェクト（フラッシュ・寄りのパンチ・揺れ・スピード線など）は型と強さを選んで `add_effects` で置く。文から絵を作らない。
効果音は手元の Stable Audio 3（または MOSS）が英語の説明から作る。映像は見ないので、鳴らす時刻（きっかけ）はエージェントが決める。
`suggest_sfx` がエフェクトとトランジションから案を出し、`generate_sfx` で作って効果音の段に置く（`wait` の `kind: "sfx"` で待つ）。
ナレーションは `set_narration` で台本と声を決め、`speak_narration` で声にする（声の AI は課金。`wait` の `kind: "voice"` で待つ）。
キャラクターがしゃべる会話劇は、Shot のセリフから声付きの Take と字幕を作る（下の「会話劇の作り方」）。

### まだ MCP でできないこと

API に口が無いので、画面で直す。

- シーケンス（章立て）を扱う（作る・Shot を入れ直す）
- Shot のロックを後から直す
- Shot の並べ替え
- 画像のクリップ（ロゴなど）をタイムラインに置く

## 会話劇の作り方

しゃべるキャラクターの短いコント（9:16）を、MCP だけで通しで作る手順（ADR-0059〜0061）。
`<...>` は前のツールが返した ID に置き換える。下の例は 2 Shot・2 人の会話。

### 1. 作品

```text
create_project {"name": "ネコとネズミ", "aspectRatio": "9:16", "concept": "ネコがネズミをチーズで誘う、20 秒のコント"}
```

### 2. キャラクター（呼び名と声の説明）

話し手には**英語の呼び名**（`speechName`）と**声の説明**（`voiceDescription`）が要る。
どちらも H3 の文に一字一句そのまま入るので、作品の途中で言い換えない（Shot ごとに声が変わる）。

```text
create_character {"projectId": "<projectId>", "name": "neko", "displayName": "ネコ",
  "identityAnchors": ["white cat", "green eyes"],
  "speechName": "The cat", "voiceDescription": "a soft, sly, teasing young woman's voice"}
create_character {"projectId": "<projectId>", "name": "nezumi", "displayName": "ネズミ",
  "identityAnchors": ["small grey mouse"],
  "speechName": "The mouse", "voiceDescription": "a high, nervous young boy's voice"}
```

後から直すときは `edit_character` の `update`。**項目は `character` の中に書く**（上に置くと無視される）:

```text
edit_character {"projectId": "<projectId>", "characterId": "<catId>", "action": "update",
  "character": {"voiceDescription": "a low, sly, purring woman's voice"}}
```

足りない話し手は、`get_project` の `characters` で `speechName` / `voiceDescription` が `null` になっている。

### 3. Shot とセリフ

`plan_shots` の `dialogues` に、Shot ごとの行を順に並べる（Shot の数と同じ長さ。セリフの無い Shot は `[]`）。

```text
plan_shots {"projectId": "<projectId>", "durationsSec": [6, 6], "dialogues": [
  [{"speakerId": "<catId>", "text": "ねえ、ネズミくん。", "translation": "Hey, little mouse."}],
  [{"speakerId": "<mouseId>", "text": "な、なに？", "translation": "W-what?"},
   {"speakerId": "<catId>", "text": "チーズ、好き？", "offscreen": true, "translation": "Like cheese?"}]
]}
edit_shots {"projectId": "<projectId>", "edits": [
  {"shotIds": ["<shot1>"], "cast": [{"characterId": "<catId>"}, {"characterId": "<mouseId>"}],
   "description": "台所の床で、ネコがネズミに顔を近づける"},
  {"shotIds": ["<shot2>"], "cast": [{"characterId": "<mouseId>"}], "description": "ネズミが壁の穴から顔を出す"}
]}
```

- 話し手は配役にいなくてよい。`offscreen: true` は画面の外の声で、映っている人は口を閉じたまま。
- 10 秒に 3〜4 行まで。5 行以上は結果の `dialogueWarnings` で知らせる（保存はされる）。
- 後から直すのは `edit_shots` の `dialogue`（行を丸ごと置き換える。`[]` で消す）。途中に Shot を挿すなら `restructure_shots` の `insert` に `dialogue`。

### 4. 最初のコマ

```text
draw_start_frames {"projectId": "<projectId>", "shotIds": ["<shot1>", "<shot2>"]}
wait {"projectId": "<projectId>", "jobs": [{"kind": "start_frame", "id": "<shot1>"}, {"kind": "start_frame", "id": "<shot2>"}]}
view {"projectId": "<projectId>", "shotId": "<shot1>"}
```

絵の指示文はセリフを見ない（静止画に声は無い）。

### 5. Take を作る

```text
generate_takes {"projectId": "<projectId>", "shotIds": ["<shot1>", "<shot2>"], "model": "vpipe/minimax-h3-turbo"}
wait {"projectId": "<projectId>", "jobs": [{"kind": "generation", "id": "<jobId>"}]}
list_takes {"projectId": "<projectId>", "shotId": "<shot1>", "includeAudio": true}
```

- セリフのある Shot は、**声を作れるモデル**（`ixa_status` の `videoModels` で `audioGeneration: true`。手元の vpipe の MiniMax H3）でだけ作れる。ほかのモデルは断る（作ると声の無い口パクになる）。`AUTO` は作れるモデルを選ぶ。
- 話し手に呼び名か声の説明が無ければ、作る前に理由を添えて止まる。
- できた Take に音があるかは、`list_takes` の `includeAudio` で付く `hasAudio`（まだ調べていなければ `null`）。

### 6. 採用する

```text
adopt_take {"projectId": "<projectId>", "shotId": "<shot1>", "takeId": "<takeId>"}
```

### 7. 字幕と訳

セリフの字幕は**自動でできる**（行ごとに 1 枚、下寄せの帯）。採用した Take の音が鳴れば話している区間に合わせ、
鳴らなければ Shot の尺を行の文字数で割り振る。手で直した時刻は保つ。

- `list_telops` で `origin: "dialogue"` のものがセリフの字幕。
- 字は Shot のセリフで直す（`edit_clips` の `text` は断って `edit_shots` の `dialogue` へ案内する）。
- **訳文が 2 段目**になる。行の `translation` に書くか、`edit_clips` の `translation` で直す（行へ書き戻す。`null` で外す）。訳文は自動では作らない。
- 2 段目の大きさは `style.translationScale`（0.3〜1、既定 0.6）。箱の余白は `marginX` / `marginY`（画面に対する割合）と `paddingX` / `paddingY`（字の大きさに対する割合）。
- セリフの字幕は、9:16 でも短いセリフを語の途中で折らない。
- セリフでない 2 段のテロップ（題名など）は `add_telops` の `translation`。

```text
edit_clips {"projectId": "<projectId>", "edits": [{"clipId": "<telopId>", "translation": "Hey there, little mouse.",
  "style": {"translationScale": 0.55, "marginX": 0.06, "paddingX": 0.4}}]}
```

### 8. Take の音と仕上げの音量

- 採用 Take の音（声・その場の音）は、既定では自動で、**セリフのある Shot だけ鳴らす**。
  `edit_shots` の `takeAudioMuted`（`true` 消す・`false` 鳴らす・`null` 自動に戻す）と `takeAudioVolume`（0〜2、既定 1）で変える。
- 書き出しの仕上げは `update_project` の `masteringMode`。`loudnorm` は全体を -14 LUFS にそろえる（曲だけの MV）、
  `peak` は山だけ -1.5 dBFS で抑えて声と曲の釣り合いを残す、`null` は自動（Take の音を鳴らす Shot があれば `peak`）。
- 実際の値は `get_project` で見る。Shot の `takeAudioPlays` が鳴るか、作品の `effectiveMasteringMode` が書き出しで使う方。
  Shot ごとの設定は `list_takes` の `takeAudio`（`muted` は実際に消すか、`auto` は自動のままか）。

```text
edit_shots {"projectId": "<projectId>", "edits": [{"shotIds": ["<shot2>"], "takeAudioVolume": 1.2}]}
update_project {"projectId": "<projectId>", "masteringMode": null}
```

### 9. 書き出す

```text
export {"projectId": "<projectId>", "waitSec": 600}
```

終われば mp4 を `IXA_MCP_OUTPUT_DIR` に保存して `filePath` を返す。待ち切れなければ `wait` の `kind: "render"` か、`export` を `renderJobId` で呼び直す。

## 確かめる

```bash
pnpm --filter @ixa/mcp typecheck
pnpm --filter @ixa/mcp lint
pnpm --filter @ixa/mcp test
```
