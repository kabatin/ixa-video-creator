# ADR-0065: setup で「全部の機能が使える」ところまで整える／klein-api の画像 AI を 3 つにする

Status: Accepted
Date: 2026-10-28
Decider: Claude（Architect）

> 番号について: この worktree を切った時点で ADR-0064（生成 AI を選んで入れる `pnpm ixa ai install`）はまだ main に無かった。
> 同じ計画の別の作業が 0064 を書くので、こちらは 0065 にした。

## 背景

- 計画「生成 AI を選んで入れる」（ADR-0064）の調べで、サーバーを入れても次のものが残ると分かった:
  テキストの AI（Claude Code・Codex・Grok）、Gemini の鍵、書き出しの headless Chrome と日本語フォント、MCP の登録。
  どれも `pnpm ixa setup` が触らないので、clone → setup だけでは一部の機能が「選べない」「動かない」。
- klein-api には FLUX.2 [klein] の 4B（`quality: draft`）があるのに ixa からは選べず、Z Image Turbo の workflow も足される。

## 決めたこと

### 1. setup の手順を 4 つ足す（どれも止めない）

音の解析の依存の後、doctor の前に回す。結果は `notice`（`fix.needsHuman`）で返し、`needs_human` にしない
（止めると doctor まで行かず、任意のものが無いだけで導入が「失敗」に見える）。

- **テキストの AI**（`text-ai.claude|codex|grok`）: 入っているか（`--version`）とサインイン済みかを見る。
  サインインは**お金も利用枠も使わない口だけ**で見る: Claude は `claude auth status --json` の `loggedIn`
  （メールアドレスなどは読まない）、Codex は `codex login status` の終了コード、Grok は確かめる口が無いので
  `~/.grok/auth.json` に記録があるかだけ（有効かは使うまで分からないと言う）。無ければ入れ方、サインインしていなければ
  `claude auth login` などを出す。
  入っていてサインインしていれば、`.env` の既定（`stub`・空）だけを切り替える（`text-ai.env`）:
  `STORYBOARD_DRAFTER=claude_cli`（テキストの初期値。画像のチェック・動きの分析・見直しはテキストが Claude のときに動く）、
  `IMAGE_PROVIDER=codex_cli`（画像の初期値）。契約の利用枠を使うので、端末で `--yes` でないときだけ聞く。`--yes` では書かずに `notice`（`fix.needsHuman: true`）を返す
  （Gemini の鍵・MCP の登録と同じ。2026-10-28 のレビューで、`--yes` で黙って利用枠を使う口に替わるのを止めた）。制作者が書いた値は触らない。
- **Gemini の鍵**（`env.gemini`）: 端末で `--yes` でないときだけ「入れますか」と聞き、鍵は**画面に出さずに**受け取る
  （`System.promptSecret`。raw モード）。`GEMINI_API_KEY`・`AUDIO_API_PROVIDERS`（`gemini_api` を足す。今ある一覧は残す）・
  `GEMINI_API_BILLING`（無料枠では原稿が Google の製品の改善に使われると言って聞く）・`GEMINI_KEY_LABEL`
  （空のときだけ `ixa-video-creator`）を書く。`--yes`・端末でないときは聞かずに「要る」を返す。
  **鍵の値はどの文にも入れない**（形の違う貼り付けも、打った値を出さずに断る）。ElevenLabs・fal は課金なので聞かない。
- **書き出しの headless Chrome**（`render.browser`）: 無ければ先に取ってくる（約 100 MB。`uv sync` と同じく聞かない）。
  取れなくても初回の書き出しで Remotion が取りに行くので止めない。
- **MCP の登録**（`mcp.claude`）: 端末で `--yes` でないときだけ「Claude Code に登録しますか」と聞き、`pnpm ixa mcp --claude --write`
  と同じ登録をする。`--yes` では書かずに 1 行を返す（ユーザーの設定を書くかは人が決める）。アクセス用の鍵は今までどおり画面で発行する。

### 2. doctor の点検を 3 つ足す（読むだけ）

- `optional.grok`: Claude Code・Codex と同じ形。
- `tools.remotion-browser`: headless Chrome があるか。**取ってこずに**見る。公開の口が `ensureBrowser` だけなので、
  取ってくる直前に呼ばれる `onBrowserDownload` で止める（`packages/render/src/browser.ts`）。置き場は作業ディレクトリで決まる
  （いちばん近い package.json の `node_modules/.remotion`）ので、書き出す worker のディレクトリで呼ぶ
  （入口は `packages/render/scripts/remotion-browser.ts`。CLI は Remotion に依存しない）。無ければ !。
- `tools.japanese-font`: 字幕の書体が先に挙げるヒラギノ（角ゴシック・明朝・丸ゴ）が `/System/Library/Fonts` にあるか。Mac でだけ見る。無ければ !。

### 3. 画像の AI を klein-api の 3 つにする

| AI の ID | 画面の名前 | klein-api | ライセンス | 目安 |
|---|---|---|---|---|
| `klein`（今まで） | FLUX.2 [klein] 9B | `flux2-klein` の `standard` | FLUX 非商用 | 1 枚 26〜50 秒 |
| `klein_4b` | FLUX.2 [klein] 4B | `flux2-klein` の `draft` | Apache-2.0 | 1 枚 約 15 秒 |
| `z_image` | Z Image Turbo | `z-image-turbo` の `standard` | Apache-2.0 | 1 枚 約 33 秒 |

- どれも `LOCAL_IMAGE_GENERATOR=klein` で有効にする（サーバは 1 台。新しい env の値は作らない）。
- モデルは `klein/flux2-klein`・`klein/flux2-klein-4b`・`klein/z-image-turbo`。klein の口は 1 つで 3 つを名乗り、
  送る workflow と段はモデルで決まる（`kleinVariantOf`）。本文の形は同じ。
- **Z Image Turbo は参照の画像を受けない**（`referenceImages.max: 0`）。キャラクターの見た目は文章だけで伝わることを選ぶ画面に出す。
  大きさは今の 3 つ（1344×768・768×1344・1024×1024）がどれも 64 の倍数なので、そのまま使う。
- 見つけ方は workflow ごとの health（`GET /v1/health` の `workflows[id].available`。sfx-api・ace-step-api と同じ）。
  部品は `packages/providers/music` から `packages/providers/video/src/local-server/workflow-health.ts` に移した。
  **`workflows` を返さない古い klein-api には `flux2-klein` しか無い**とみなし、Z Image を「無い（新しい版にする）」と言う
  （選べるように見せて投入で 404 にしない）。
- **9B と 4B は段ごとの health で見る**（2026-10-28 のレビューで決めた契約。klein-api 側も同時に出すよう直す）:
  `workflows["flux2-klein"].qualities = {"draft": {"available": bool, "reason": str|null}, "standard": {...}}`。
  `klein`（9B）は `standard` が使えるときだけ、`klein_4b` は `draft` が使えるときだけ「使える」。
  4B だけ入れた klein-api でも、今までは workflow が使えるので 9B（非商用）まで「使える」と出て、しかも最初に勧めていた。
  見る段は AI の表が持つ（`AI_TOOLS[...].detect.quality`）。`qualities` を返さない古い版は今までどおり workflow で見る。
  一覧にない段を頼まれたら「無い」と答える。理由の文は workflow と同じく置き場所を出さない。
- 勧める順は Codex の次に、**商用にも使える Apache-2.0 の 4B・Z Image Turbo を先に、非商用の 9B を最後に**置く
  （`codex_cli` → `klein_4b` → `z_image` → `klein`）。黙って非商用の重みを初期値にしない。

## 分かっている不足

- klein-api の Z Image Turbo の workflow と、health の `workflows` は別の作業で足される。ixa の契約テストは
  `docs/api.md` の flux2-klein と同じ本文・sfx-api と同じ health の形を前提にしている。形が違えば契約テストを直す。
- 段ごとの health（`qualities`）を返さない古い klein-api では、4B・9B のどちらかの重みが無くても両方「使える」と出る。投入の失敗が理由を言う。
- `promptSecret` の実物（raw モードの入力）は端末でしか確かめられない。単体テストは偽物で、鍵が文に出ないことだけを見る。
- `.claude/skills/ixa-setup`・INSTALL.md の手順は、2026-10-28 のレビューの直しで書き足した（INSTALL.md「任意」）。
