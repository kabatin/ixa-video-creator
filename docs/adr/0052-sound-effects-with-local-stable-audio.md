# ADR-0052: 手元の Stable Audio 3（MLX）で効果音を作る（sfx-api）

Status: Accepted
Date: 2026-10-18
Decider: Claude（Architect）

## 背景

NIGHT RUN 予告編への制作者のフィードバック（2026-10-17）:「SFX などの効果音が何もなく臨場感ゼロ」。
タイムラインには前から効果音の段（`SFX`）があり、音の素材を手で置けるが、効果音そのものを作る口が無い。

2026-10 時点の調査（tasks/todo.md の夜間作業）:

- 映像から音を作るモデル（MMAudio・PrismAudio・ControlFoley・Woosh）は**重みが非商用**か、**Mac で動かない**
  （HunyuanVideo-Foley・LTX-2.3 Foley は CUDA 前提か巨大）
- 文章から効果音を作る **Stable Audio 3 Small SFX** には Stability AI 公式の **MLX 版**があり、Apple Silicon で
  10 秒の音を約 1 秒（M1 8GB で 1.6GB）。Stability AI Community License で、年商 100 万ドル未満は商用可
  （制作者の年商はこの範囲。2026-10-18 確認）
- 控えに **MOSS-SoundEffect v2.0**（Apache 2.0・48kHz・PyTorch mps）

制作者の決定（2026-10-18）: **メインを Stable Audio 3 MLX、サブを MOSS**。新しい Mac（vpipe・klein・ace-step と同じ機械）で動かす。

## 決めたこと

### 1. 契約は ace-step-api と同じ v1 のジョブ式（sfx-api）

既定の口は `http://127.0.0.1:8769`（実運用は新しい Mac）。workflow は 2 つ:
`stable-audio-3-sfx`（メイン・44.1kHz）と `moss-sfx-v2`（サブ・48kHz）。

投入 `POST /v1/workflows/{workflow}/jobs`:
`prompt`（英語 1〜500 字）・`negative_prompt`（省略可）・`duration_sec`（0.5〜10）・`count`（1〜4）・`seed`（省略可）。
出来上がり: `result.outputs[]` に `{ index, media_type: 'audio/wav', duration_sec, sample_rate, seed_used }`。
Bearer・`Idempotency-Key`・429 + `Retry-After`・失敗の封筒・取消・`GET /v1/health` は ace-step-api と同じ。
**契約は ixa 側で先に固める**（ADR-0048 と同じ。サーバの `docs/api.md` ができたら突き合わせる）。

サーバ側（新しい Mac で作った sfx-api）と突き合わせて決まったこと（2026-10-18）:

- 状態の綴りは `canceled`（ace-step-api と同じ。`cancelled` も読み替えて受ける）
- i 本目の種は `seed + 2i`。**`outputs[].seed_used` が正**で、その種を `count: 1` で送ると同じ音が返る
  （`stable-audio-3-sfx` はビット一致）
- `outputs[]` は `sample_rate` と `channels` を持つ（Stable Audio は 2、MOSS は 1。**モノラルも受ける**）
- `GET /v1/health` は `workflows: { [id]: { available, loaded, reason } }` を足す。`available: true, loaded: false` は
  待機中のふつうの状態。「使う AI」は **workflow ごとに**見て、使えない方だけ理由つきで灰色にする
- 使えない workflow へ投入すると 503 `workflow_unavailable`（理由つき）。**使えない間はやり直せない失敗**として、
  日本語の理由（もう一方の AI を選ぶか、準備ができてから）を画面に出す
- `negative_prompt` は MOSS が使う。Stable Audio は受けるが既定では使わない（`capabilities` の `negative_prompt.applied`）
- 音量はピークが -1 dBFS を超えた音だけを下げる（リミッタはかけない）
- 速さ（M5・温まった状態・1 本）: Stable Audio は 2 秒の音で 0.37 秒・10 秒で 0.53 秒、冷えていれば 3.2 秒・約 4GB。
  MOSS は MPS で動くが遅く、2 秒の音に 273 秒（測り直し中）。**待つ上限はモデルごと**（Stable Audio 5 分・MOSS 90 分）。走り出してから数え、生成先の順番待ち（同じ機械の vpipe などが空くまで。実測 22 分）は別に 2 時間まで待つ

### 2. 「使う AI」に効果音を足す

用途 `sfx`（効果音）。選べるのは `stable_audio_sfx`（Stable Audio 3・手元）・`moss_sfx`（MOSS・手元）とお試し。
**お試しは効果音を作らない**（頼むと 409 で「効果音の AI を選んで」と言う）。どちらも同じ sfx-api の別の workflow。
`LOCAL_SFX_GENERATOR=sfx_api` と書いたときだけ health を見る。`ai_settings.sfx_tool` の既定は `stub`。

### 3. 鳴らす時刻は ixa が決める（映像は渡さない）

文章から作るモデルは映像を見ない。だから**どこで何が鳴るかは ixa の側が決める**:

- **きっかけ（cue）** = 時刻・長さ・何の音か（英語の説明）・音量。人か MCP のエージェントが決める
- 案を出す純粋な関数 `suggestSfxCues`（domain）: タイムラインのエフェクトとトランジションから案を出す
  （フラッシュ・寄りのパンチ → 衝撃音、whip_pan → 風切り、タイトルカード → 低い衝撃、スピード線 → 走り抜ける風切り、
  揺れ → 鈍い衝撃）。Shot の中身に合わせた音（エンジン・タイヤ・雨）は説明から人かエージェントが足す
- 1 つのきっかけで `count` 本作り、**1 本目を効果音の段に置く**。残りは素材に候補として残す（差し替えられる）

### 4. ジョブとできた音

`sfx_jobs`（追記のみ）に、きっかけ（時刻・長さ・説明・音量）・モデル・状態・できた素材を持つ。
API はジョブを作って `sfx` キューへ入れるだけで、作るのは worker。できた音は 1 本ずつ素材（`origin: generated_sfx`、音）にし、
1 本目を `SFX` の段のクリップにする（`media`・`inSec 0`・`outSec` = 実際の長さ・`volume` = きっかけの音量・短いフェードアウト）。
GPU は動画・絵・曲と同じ整理券（`generation/local-gpu-turn.ts`）に並ぶ。

### 5. 書き出しと試聴

効果音の段のクリップは、今までどおり Remotion の `<Audio>` で鳴る（プレビュー＝書き出し）。
曲の下げ（ducking）は声だけに効き、効果音では下げない。

### 6. MCP

`generate_sfx`（きっかけの一覧・モデル・本数）と `suggest_sfx`（エフェクトとトランジションからの案）。
置いた音は `list_sfx`（または既存のクリップの一覧）で確かめ、`remove_sfx` で外せる。

## 今回の外

- **映像から音を作る路線**（同期の自動化）。商用可で Mac で動くものが無い。CUDA 機ができたら別の ADR
- 効果音のライブラリ（作った音を作品をまたいで使い回す）
- 曲との音量の自動調整（効果音で曲を下げる）
- 費用の表示（手元の GPU で 0 円）
