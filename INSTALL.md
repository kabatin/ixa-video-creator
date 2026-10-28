# INSTALL.md — エージェント向けの導入・点検・更新の手順書

> For AI agents (Claude Code / Codex) asked to install, check or update ixa on a Mac.
> Follow this file from top to bottom. Whenever it says **人に聞く (ask the human)**, stop, show the human the
> message and the suggested fix, and wait for their answer. Never print secret values.

人が手で入れるときも同じ手順でよい（`pnpm ixa setup` が全部やる）。決めたことは [ADR-0063](./docs/adr/0063-ixa-cli-setup-doctor-update.md)。
手元の生成 AI（動画・絵・曲・効果音・文字起こし）は別の手順（下の「手元の生成 AI」、[ADR-0064](./docs/adr/0064-select-and-install-local-ai.md)）。

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
| Claude Code / Codex の設定に MCP を書き込む（`--write`・setup の `mcp.claude`） | 人の設定を書き換える |
| テキスト・画像の AI の初期値を Claude Code / Codex にする（setup の `text-ai.env`） | 契約の利用枠を使う |
| 値の入った接続先（`*_API_URL`）を替える（`--overwrite-env`） | 別の Mac を指す設定を消しかねない |
| 手元の生成 AI を入れる（`pnpm ixa ai install`）: **どれを入れるか・ライセンスの同意・大きなダウンロード** | ライセンスに同意するのは制作者。数 GB〜数百 GB を落とす |
| 手元の生成 AI のために Homebrew で入れる（`brew install whisper-cpp`） | その Mac にソフトを入れる |

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
  pnpm は `npm install -g corepack && corepack enable && corepack prepare pnpm@9.15.4 --activate` で入る（人に聞かなくてよい）。
  Node 25 以降は corepack が同梱されないので、`npm install -g corepack` から始める。
- `setup` は何度実行しても壊れない。済んだ手順は `already`（済み）になる。
- `--yes` は途中の質問（Docker Desktop を起動するか）に「はい」で答える。人の同意が要る手順は飛ばして `needs_human` を返す。
  任意のもの（テキストの AI の初期値・Gemini の鍵・MCP の登録）は `--yes` では書かずに `notice` を返す（下の「任意」）。

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
| `tools.pnpm` | `npm install -g corepack && corepack enable && corepack prepare pnpm@9.15.4 --activate` | いいえ |
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
- postgres・redis だけを起こす・止めるのは `pnpm ixa infra up` / `pnpm ixa infra down`（`pnpm infra:up` / `infra:down` も同じ）。
  **`docker compose` を直に打たない**（別の clone のスタックを止めてしまう）。`down` はデータを消さない。`-v` は付けない。

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
（`ixa-postgres`・5432）につながる。setup はそれを見つけると `infra`（DB の更新・初期データ・update でも）で `needs_human` で止まる。
名前だけ替えても、`DATABASE_URL`・`REDIS_URL` のポートを別の clone のコンテナが持っていれば止まる。
`POSTGRES_PORT` と `DATABASE_URL` のポートが違う（`REDIS_*` も）・`IXA_COMPOSE_*` の形が違うときは `env.valid` で止まる。
**どちらにするか人に聞く**:

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

無くても画面は開けて作品は作れるもの。setup はどれも**止めずに**知らせる（`notice`。人が決めるものは `fix.needsHuman: true`）。
setup はこの順に回す: 音の解析の依存の後、テキストの AI → Gemini の鍵 → 書き出しの headless Chrome → MCP の登録（[ADR-0065](./docs/adr/0065-setup-covers-every-feature-and-klein-image-models.md)）。

**setup の手順**

| id | すること | 人に聞く |
|---|---|---|
| `text-ai.claude` / `text-ai.codex` / `text-ai.grok` | 入っているか・サインイン済みかを見るだけ（AI には何も頼まない。メールアドレスは読まない）。無ければ入れ方、サインインしていなければ `claude auth login`・`codex login`・`grok login` を出す。Grok は確かめる口が無く、記録があるかだけ | 入れる・サインインするのは人 |
| `text-ai.env` | 入っていてサインイン済みなら、`.env` の既定（`stub`・空）だけを `STORYBOARD_DRAFTER=claude_cli`・`IMAGE_PROVIDER=codex_cli` に替える。**契約の利用枠を使う**ので、端末で `--yes` でないときだけ聞く。`--yes` では書かずに `notice` を返す | はい（人に聞いてから、端末で `pnpm ixa setup` を回して「はい」か、画面の「使う AI」で選ぶ） |
| `env.gemini` | Gemini の鍵（声・文字起こし）。端末で `--yes` でないときだけ「入れますか」と聞き、鍵は**画面に出さずに**受け取る。`GEMINI_API_KEY`・`AUDIO_API_PROVIDERS`（`gemini_api` を足す）・`GEMINI_API_BILLING`・`GEMINI_KEY_LABEL` を書く。`--yes`・端末でないときは聞かずに「要る」を返す | はい（**原稿が Google に送られる**。無料枠では製品の改善に使われる。鍵は人が貼る。エージェントは鍵を受け取らない） |
| `render.browser` | 書き出しの headless Chrome（約 100 MB）を先に取ってくる。取れなくても初めての書き出しで取りに行くので止めない | いいえ |
| `mcp.claude` | Claude Code に ixa の MCP を登録する。端末で `--yes` でないときだけ聞き、「はい」なら `pnpm ixa mcp --claude --write` と同じ登録をする。`--yes` では書かずにその 1 行を返す。Claude Code が無ければ飛ばす | はい（人の設定を書き換える。下の「5. MCP の登録」） |

**doctor の点検**

- `optional.claude` / `optional.codex` / `optional.grok`（!）→ 無くても動く。AI エージェントのタブ・絵コンテの案・絵のチェックは Claude Code、
  絵コンテの画像は Codex、テキストの控えは Grok を使う。入れるかは人が決める。
- `tools.remotion-browser`（!）→ 書き出しの headless Chrome がまだ無い。`pnpm ixa setup` が取ってくる（人に聞かなくてよい）。
  `-`（確かめられない）は依存が入っていないとき。`pnpm install` の後にもう一度。
- `tools.japanese-font`（!）→ 字幕のヒラギノ（角ゴシック・明朝・丸ゴ）が `/System/Library/Fonts` に無い。書き出しは別の書体になる。
  Font Book の「標準フォントを復元」を人に頼む。Mac 以外では `-`。
- `optional.whisper-model`（-）→ 文字起こしのモデルは初めて使うときに取ってくる（約 500 MB）。失敗ではない。
- `optional.storage` → 素材の置き場（既定 `~/ixa-video-creator/storage`、`.env` の `STORAGE_DIR`）に書けるか・空き。
- `local-ai.*`（!）→ `.env` で有効にした手元の AI サーバー（vpipe・wan・klein・ace-step・sfx）に届かない。
  入っていなければ下の「手元の生成 AI」。入っているなら起動は人に頼む。

## 手元の生成 AI

この Mac（Apple Silicon）の GPU で、費用を掛けずに動画・絵・曲・効果音・文字起こしを作る AI を、**選んで**入れる。
入れ方は各サーバー（vpipe-api・wan-api・klein-api・ace-step-api・sfx-api）の `setup` が持ち、ixa はそれを呼ぶだけ。

**1. 一覧を見る（何も変えない）**

```bash
pnpm -s ixa ai install --plan --json
```

`plan.machine`（Apple Silicon か・macOS・メモリ・空き）と、`plan.items` の各行（`id`・`kinds`・`downloadGb`・`peakDiskGb`・
`ramGb`・`minMacos`・`licence.summary`・`licence.url`・`runnable`・`reason`・`state`）を見る。

**2. 人に聞く**（ここで必ず止まる）: `runnable: true` の中から、**どれを入れるか**を人に選んでもらい、選んだものの
**ライセンスの要点と URL** と**合計の容量**を見せて同意を取る。例:

| id | 気をつけること |
|---|---|
| `h3` | MiniMax H3 Community License。米国・EU・英国・韓国では使えない。約 118 GB（準備中は最大 185 GB）・macOS 26 以上 |
| `minimax-music3` | 画面に「MiniMax-Music3」の名前を目立つように出す。年商 2000 万ドル超は許可が要る |
| `sa3-medium` / `sa3-small` | Stability AI Community License。年商 100 万ドル未満なら無料、商用は登録が要る |
| `klein-9b` | FLUX.2 [klein] 9B。FLUX Non-Commercial License、**重みは商用不可**（作った画像は使える）。約 17.8 GB・メモリ約 11 GB |
| `klein-4b` | FLUX.2 [klein] 4B（下書き。速い）。Apache-2.0 で商用可。約 8.6 GB・メモリ約 5 GB |
| `z-image-turbo` | Z Image Turbo。Apache-2.0 で商用可。約 10.9 GB。**キャラクターなどの参照の画像は使えない**（見た目は文章で伝える） |
| `whisper-cpp` | Homebrew で `whisper-cpp` を入れる |

**3. 入れる**（同意を得た ID だけを、両方に書く）:

```bash
pnpm -s ixa ai install --models sa3-small,klein-4b --accept-licenses sa3-small,klein-4b --yes --json
```

- `--accept-licenses` に無い ID が 1 つでもあると、何も入れずに `needs_human` で止まる。**人の同意なしに足さない。**
- 空きが足りなければ止まる（`failed`）。空けるか、選ぶものを減らすかを人に聞く。
- 何度実行しても壊れない（入っているものは `already`）。あとから 1 つ足してもよい。
- `.env` の `LOCAL_*_GENERATOR` に足し、接続先を書いて、最後に doctor を回す。値の入った接続先（別の Mac を指す `*_API_URL` など）を替えるときは、何も書かずに止まる（`ai.env.kept`）。人に聞いて、替えてよければ `--overwrite-env` を足してもう一度（`--yes` では替わらない）。
- klein は入れたあと、Mac の画面に「ほかのアプリのデータへのアクセス」の確認が出る（`needs_human`）。**人に画面で許可してもらう。**
- 画像の 3 つ（`klein-9b`・`klein-4b`・`z-image-turbo`）は同じ klein-api に入り、どれも `LOCAL_IMAGE_GENERATOR=klein` で有効になる。
  ixa は入っている段だけを「使える」にし（4B だけなら 9B は出ない）、まだ選んでいなければ商用可の 4B → Z Image Turbo → 9B の順に勧める。
- 人が手で入れるなら `pnpm ixa ai install`（番号で選び、ライセンスに 1 つずつ y で答える）。

**別の Mac（AI 用）に入れる**: その Mac で次の 1 行（ixa の clone も Node も要らない。uv だけ）。

```bash
uv run https://raw.githubusercontent.com/kabatin/ixa-video-creator/v0.8.2/tools/ixa-ai/ixa_ai.py install --lan
```

`<版>` は ixa の版のタグ（例 `v0.8.1`）。最後に接続コードが**端末に 1 回だけ**出る（端末でなければ出さずに止まるので、ターミナルで回す）。
合言葉を含むので、人にコピーしてもらい、ixa の Mac の clone で次を打って、聞かれたら貼ってもらう（画面には出ない）。
エージェントは接続コードをチャットやファイルに写さない。

```bash
pnpm ixa ai connect
```

`pnpm ixa ai connect <接続コード>` と引数でも渡せるが、`ps` の一覧とシェルの履歴に残るので勧めない。

**調子を見る**: `pnpm -s ixa ai status --json`（手元の AI サーバーに届くかだけ）。

## 5. MCP の登録

setup の `mcp.claude` が Claude Code の分を受け持つ（端末で「はい」と答えれば登録済み・`already` なら済み）。
`setup --yes` では書かずに `notice` と 1 行（`pnpm ixa mcp --claude --write`）を返すので、その 1 行を人に見せて許可を取る。
Codex は setup では触らない。

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
  動いているジョブがある（`update.active-jobs`）／ この clone の dev が動いている（`update.dev-running`）／
  main がタグより先・枝分かれ（`update.fast-forward`）。どれも人に聞く。
  - `--force` はジョブの確認だけを外す。`--while-running` は dev を動かしたまま進める（別の同意）。**どちらも人の許可なしに付けない**。
  - ジョブを数えられなかった（`update.active-jobs` が `failed`。合言葉違いなど）→ `pnpm -s ixa doctor` で DB を見る。
    DB が動いていないだけなら 0 件とみなして進む（JSON の `activeJobsReason` に理由）。
  - `update.stale-jobs`（`notice`）→ 24 時間より前から「動いている」のままの行（取り残し）。数えていない。消すかどうかは人が決める。
- 中で起きること: `git fetch --tags` → タグへ fast-forward → 途中の印を置く → `pnpm install --frozen-lockfile` →
  **新しい版の CLI** が `uv sync` → DB の更新 → 新しく増えた `.env` の項目の一覧（値は書かない）→ 印を消す → doctor。
- **途中で止まったら**（`update.pending`・doctor の `tools.update-pending`）→ 原因を直して `pnpm -s ixa update --resume`。
  「最新です」と出ても、印があるうちは更新が済んでいない。
- `update.new-keys`（`notice`）→ 新しい項目を人に伝える。`devRestartNeeded: true` → 「dev を起動し直してください」と伝える（勝手に止めない）。
- 変更点は `releaseNotes` の URL。
