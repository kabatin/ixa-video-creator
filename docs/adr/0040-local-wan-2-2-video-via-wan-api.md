# ADR-0040: 手元の Wan 2.2 TI2V-5B を wan-api 経由の Provider として足す

Status: Accepted
Date: 2026-10-06
Decider: Claude（Architect）。制作者の選択（2026-10-06「ixa-video-creator に Wan 2.2 TI2V-5B ローカル動画生成を追加する」）

## Context

手元の動画生成は vpipe-api 経由の MiniMax H3 だけ（ADR-0031）。1 本 7〜25 分かかり、
出来は開始画像に強く依存する。制作者は同じ Mac（M5・10 コア GPU・32GB）で **Wan 2.2 TI2V-5B** を
動かせるようにしたいと考えており、どちらが MV・ナレーション動画に向くかを**実測で比べたい**。
H3 を置き換えるのではなく、**選べるもう 1 つ**として足す。

### 契約の正は wan-api の `docs/api.md`

生成サーバは別リポジトリ **wan-api**（https://github.com/kabatin/wan-api 。既定 `http://127.0.0.1:8766`）。
**契約の正はそちらの `docs/api.md`（v1）と `GET /v1/capabilities`** で、vpipe-api と同じ
ジョブの流れ・失敗の封筒・429 + `Retry-After`・`Idempotency-Key` を持つ。違うのは
ワークフロー名と投入の本文だけ、と明記されている。

このアダプタを書き始めた時点（2026-10-06）では wan-api はコミット 0 だったので、
いったん vpipe-api v1 を正として組み、**実物が push された時点（2026-10-07）で突き合わせた。**
食い違っていた 2 点は実物に合わせた（末尾の追記）。

### 32GB の Unified Memory は 1 つしかない

vpipe-api も wan-api も「自分は 1 本ずつ」しか守れず、**互いを知らない**。
両方を有効にすると 2 本が同時に Metal で生成を始め、メモリを取り合ってスワップし、
両方が大幅に遅くなる（最悪は OOM）。**止められるのは投入する側（ixa の worker）だけ**である。

## Decision

### 1. Provider `wan` とモデル 2 つ（AUTO には選ばせない）

| モデル | 画面の名前 | 段 |
|---|---|---|
| `wan/wan2.2-ti2v-5b-draft` | Wan 2.2 5B 下書き（ローカル・無料） | draft |
| `wan/wan2.2-ti2v-5b` | Wan 2.2 5B（ローカル・無料） | standard |

命名は既存に揃える（`<Provider の id>/<モデル>`、下書きだけ `-draft`。`vpipe/minimax-h3-turbo-draft` と同じ形）。
指示書の候補 `local/...` は使わない。`local` は既に「静止画を動かす」Provider の id で（ADR-0025）、
先頭の語は Provider の id という既存の規則と食い違う。

- **`routable: false`。** 費用 0 は Router のスコアで圧倒的に有利なので、候補に入れると AUTO が黙って寄る。
  「使う AI」の動画で Wan を選んだときだけ、その中の 2 つから AUTO が選ぶ（vpipe と同じ扱い）
- 費用は 0（手元の GPU）。**スタブ扱いにしない**（`STUB_PROVIDER_IDS` に入れない）
- **AUTO の routing は今回やらない。** 実測（品質・速度・尺別のコスト）がまだ 1 本も無く、
  比べる材料がない。材料を作るのが §6 の記録

### 2. 契約（wan-api の `docs/api.md`）

vpipe-api v1 と同じ流れ。**違うのはワークフロー名と投入の本文だけ。**

```
GET    /v1/health                            → { status, version, running, waiting, max_waiting }
GET    /v1/capabilities                      → 受ける値の宣言（尺の範囲・大きさ・段）。**descriptor の正**
POST   /v1/workflows/wan2.2-ti2v-5b/jobs     → 202（新規）/ 200（同じ冪等キーの既存ジョブ）
GET    /v1/jobs/{id}                         → queued → running → succeeded | failed | canceled
GET    /v1/jobs/{id}/output                  → video/mp4（succeeded まで 409）
DELETE /v1/jobs/{id}                         → 取消（200、まだ止まっていなければ 202。終わっていれば 409）
```

- 失敗の封筒は共通（`{ error: { code, message, retryable, details } }`）
- 満杯は **429 + `Retry-After`**（何も積まれていない）
- `Idempotency-Key`（1〜128 文字の `[A-Za-z0-9._:-]`）を**必ず**送る。同じキー・同じ中身は
  新しく作らず既存のジョブを 200 で返す。処理中なら 409 `idempotency_in_flight`（retryable）、
  中身が違えば 409 `idempotency_conflict`（終端）
- 出力は **H.264 MP4・24fps・音声トラック無し**。サーバが ffprobe で検査してから成功にする
  （大きさ・コマ数・fps・音なしが契約どおりか）

投入の本文（`POST /v1/workflows/wan2.2-ti2v-5b/jobs`）:

| field | type | notes |
|---|---|---|
| `prompt` | string 1〜4000 | 画を説明する |
| `output` | `{width, height}` | 最終の大きさ（偶数・64〜4096・比は 9:16〜16:9）。サーバが作れる大きさで作って cover + 中央切り抜きで合わせる |
| `duration_seconds` | number 1.0〜5.0 | **頼む尺（秒・float）。コマ数は送らない**（§3）。`floor(秒 × 24 + 0.5)` コマで返る |
| `quality` | `"draft"` \| `"standard"` | 生成の段。サーバがこれを実行設定へ訳す（§4） |
| `seed` | int 0〜2³¹−1 \| null | `result.seed_used` で返す |
| `start_image` | image \| null | 最初のフレーム。`{ data: base64, media_type }`、戻した大きさ 20MB・50 メガピクセルまで |

**`frames` も `steps` も `scheduler` も送らない。** それどころか、**ここに無い項目を送ると 422 で断られる**
（モデル名・ステップ数・サンプラー・LoRA・パス）。モデル固有の都合を PF へ漏らさないことが、
サーバ側でも守られている（§4）。

`negative_prompt` は受けるが**宣言しない**（§4 の理由。null = エンジンの既定）。

ixa が見る失敗の code は、サーバの `code` に `wan_` を付けたもの。終端にするか待つかは
サーバの `retryable` に従う。`503 insufficient_storage`（置き場が 2GB を切った）と
`422 start_image_unsupported`（`drawthings` の口では最初のフレームが使えない）もこの形で届く。

取り消しの綴りは `canceled`（wan-api も vpipe-api も 1 つの `l`。実物で確認済み）。
ただし **`cancelled` も受けるようにしてある**（同じ契約を実装する別のサーバ——今後の LTX・Hunyuan——が
素直にそちらを返しうる。綴りの違いだけで「応答の形が違う」として終端の失敗にすると、取り消しが失敗として残る）。
寄せるのはこの 1 語だけで、知らない状態は寄せずに検証へ渡す。

**`timings`**（`queue_seconds` / `backend_seconds` / `sampling_seconds` / `postprocess_seconds` /
`total_seconds`）は wan-api だけが返す。比べるときは**これを正とする**（§8）。
ixa 側で時刻の差から出すと、問い合わせの間隔（30 秒おき）の分だけ長く見える。

### 3. 尺は秒（float）だけを送る。コマ数へ合わせるのは wan-api

Wan にもコマ数の制約（4n+1）はあるが、**domain にも PF にも入れない**（規約 3）。

- 宣言は `durations: { mode: 'range', min: 1, max: 5 }`（刻み無し）。楽曲のタイムラインが決めた
  端数の秒がそのまま通る
- wan-api は「4n+1 に載る必要なコマ数以上を作って、**`floor(duration_seconds × 24 + 0.5)` コマちょうど**に
  揃えて返す」。差は最大 1/48 秒（0.021 秒）で、technical レビューの尺の検査（±0.05 秒）に収まる
  （実測: 5 秒を頼んで 120 コマ・5.000 秒）
- 切り詰めるのは末尾。最初のフレームを条件にした生成では捨てる絵が無い（最後のフレームを条件にする口は
  宣言していないので、H3 で enum を選んだ事情（ADR-0031 §2）は起きない）
- **上限 5 秒は wan-api の契約そのもの**（`/v1/capabilities` の `duration_seconds: {min:1.0, max:5.0}`）。
  TI2V-5B の素の長さがそこまでで、広げてもサーバが 422 で断る

**H3（10.125 秒）より短いことの帰結**（ADR-0011 の切り上げがそのまま載る）:

| Shot の尺 | Wan を選んでいるとき |
|---|---|
| 〜5 秒 | そのまま作る |
| 5〜7.5 秒 | 5 秒で作って**ゆっくり再生で埋める**（`Shot.timing = 'fit'`） |
| 7.5 秒超 | 作れない。「Shot を分けてください」と言う |

長いカットは H3 を選ぶか、Shot を分ける。**黙って縮めたり引き伸ばしたりはしない。**

### 4. 送るのは段（tier）だけ

`draft` / `standard` の 2 つだけを送り、**解像度・ステップ数・スケジューラ・量子化・LoRA・
生成解像度・重みのファイル名は 1 つも送らない。** それを wan-api がモデルの実行設定へ訳す。

こうしておけば「draft を 3 step から 4 step にする」「高速化 LoRA を替える」「MLX の実装に替える」を
**ixa の変更なしで**できる。PF を「モデル実験の GUI」にしない。

negative prompt は**宣言しない**。Wan 自体は解するが、ixa の仕様（`ShotGenerationSpec`）に
それを入れる画面が無く、`compileSpec` は常に null を渡す。既定の negative prompt を持つなら wan-api の責務。

### 5. 実装は vpipe と共通（`local-server/`）

vpipe の HTTP・投入・出力の取り込み・控え・冪等キー・満杯の扱いは **vpipe-api v1 契約の実装**であって
H3 固有ではない。これを `packages/providers/video/src/local-server/` へ出し、vpipe と wan は

- モデルの宣言（`descriptor.ts`）
- 投入の本文の組み立て（`request.ts`）
- 束ね直し（`provider.ts`。10 行ほど）

だけを持つ。サーバ 1 台分の違い（名前・失敗の code の頭・ワークフロー名・直し方の案内）は
`LocalServerIdentity` 1 つに集める。**今後 Wan A14B・LTX・Hunyuan が増えても、増えるのはこの 3 つだけ。**

既存の vpipe の契約テスト（約 2,000 行）は**assertion を 1 つも変えずに**通る。それが
「H3 を壊していない」ことの証明になっている。

登録の条件（`.env` の値 → どの Provider を作るか）は `local-server/wiring.ts` の 1 か所に置く。
以前は API（`main.ts`）と worker（`generation-wiring.ts`）に書き写されていて、片方だけ直すと
「API のモデル一覧には出るのに worker が未登録のモデルとして落とす」になった。

### 6. この機械の GPU は 1 本ずつ（`local-gpu`）

**Architect の変更（`packages/providers/core` と worker）。**

- `VideoProvider` に `exclusiveResource?: 'local-gpu'` を足す（任意。省略は制限なし）。
  手元の生成サーバの Provider がこれを名乗る。**domain には GPU の概念を入れない**
- worker に**期限付きの借り**（`apps/worker/src/generation/local-gpu-lease.ts`）を足す。
  置き場は Redis（キューと同じ）。プロセスの中のミューテックスでは worker を 2 つ立てた時点で効かない
- 借りるのは**投入の直前**（開始画像を取り寄せる前）。借りられなければ **`ProviderBusyError` と同じ経路**に乗せる
  （ADR-0031 §5）。ジョブは queued のまま・`attempt` は増やさない・画面は「順番待ち」。
  **満杯と同じ扱いにできるので、新しい状態も新しい画面も要らない**
- 期限は 5 分（`LOCAL_GPU_LEASE_TTL_MS`）。問い合わせ（手元のサーバは 30 秒おき）のたびに延ばす。
  worker が落ちても 5 分で空く（**stale lock で永久に止まらない**）
- 返すのは、終わった時点（succeeded / failed）・投入が満杯で断られた時点・取り消しに気付いた時点・
  終端の失敗を書いた時点。**予約し直すときは返さない**（生成先では走り続けているので、
  返すと 2 本目が始まってしまう）
- **クラウドの Provider（fal）は借りない。** ローカルが作っている間もクラウドの生成は進む
- 期限が切れている間に別の生成が借りていたら（2 本が同時に走っている）、黙って進まず warn に残す

取り消しのときは API が生成先へ止めてと頼む（`generation-cancel.ts`）。借りを返すのは worker が
次に見たとき（最大 30 秒後）で、それまでは次の生成が待つ。

### 7. 設定は明示の切り替え（カンマ区切りの一覧）

- `LOCAL_VIDEO_GENERATOR=none|vpipe|wan|vpipe,wan`（既定 `none`）。**一覧にした**のは、
  両方を有効にできないと §6 の順番が意味を持たないため。`AUDIO_API_PROVIDERS` と同じ形
  - `none` をほかの値と並べたら起動時に止める（どちらかを黙って採らない）
  - 同じ値を 2 回書いても 1 つとして扱う（同じモデル ID を 2 度登録できない）
- `WAN_API_URL`（既定 `http://127.0.0.1:8766`）、`WAN_API_TOKEN`（空なら未設定。Bearer で送る）
- **URL やトークンの有無で切り替えない**（LESSONS「鍵があることを、実行の合図にしない」）
- 検査の規則は vpipe と 1 つにする（`packages/config/src/local-video.ts` の表）。
  このマシンの外を指しているのにトークンが無い設定は、**必ず 401 になるので起動時に止める**。
  片方にしか検査が無いと、同じ設定ミスが wan では生成を押してから分かることになる

### 8. 比べるための記録（ADR-0040 の目的）

生成 1 本につき 1 行だけログに残す（`apps/worker/src/generation/benchmark.ts`）。
**プロンプトの全文も画像も署名付き URL も入れない。** 入るのは数字と識別子だけ。

`provider` / `modelId` / `qualityTier` / `requestedDurationSec` / `totalElapsedSec` /
`remoteQueuedSec` / `generationSec` / `outputDurationSec` / `failureType`

- 生成先が報せた実測（`queuedSec` / `renderSec`）を正とし、無ければ worker が測った時刻から出す
- **失敗したときも同じ形で残す。** 失敗だけ残らないと、失敗の多いモデルが速く見える
- Take には今までどおり `providerParams`（raw）へ入る。**domain は変えない**

## Consequences

- 「使う AI」の動画に「手元の Wan 2.2 5B（wan・無料・1 本ずつ）」が増える。生成欄のモデルは 2 つ
- H3 と Wan を両方有効にできる。**同時には作らない**ので、2 本頼むと順に仕上がる
- **5 秒を超える Shot の扱いが AI で変わる**（上の表）。H3 から Wan へ切り替えると、
  長いカットでゆっくり再生になるか、分けてもらうことになる
- **H3 のほうが速く、Wan のほうが開始画像を保つ**（下の実測）。どちらを使うかは作る人が選ぶ
- wan-api の口（backend）が `drawthings` のときは、最初のフレームを渡すと
  `422 start_image_unsupported` で断られる（I2V は `mlx` の口だけ）。既定は `mlx`
- **ライセンス**: Wan 2.2 の重みは Apache-2.0（商用可）。ixa は重みを同梱せず、
  wan-api も別リポジトリ。配布の条件（著作権表示とライセンス文の保持）は動かす人に及ぶ

### 実測（wan-api の `docs/benchmark.md`。2026-10-06・M5 10 コア GPU・32GB・AC 電源・出力 832x480）

| | H3（vpipe・draft） | Wan draft（8 step） | Wan standard（20 step） |
|---|---|---|---|
| 5 秒 1 本 | **444 秒**（7.4 分） | **675 秒**（11.3 分。文章が同じなら 578 秒） | **1167 秒**（19.4 分） |
| 2.5 秒 1 本 | — | 279 秒（文章が同じとき） | — |
| 出来たコマ / 尺 | 124 / 5.167 秒（17n+5） | 120 / 5.000 秒（**頼んだとおり**） | 120 / 5.000 秒 |
| 1 コマ目と開始画像の SSIM | 0.695 | **0.851** | 0.852 |
| 生成中の峰のメモリ | 未計測 | 22.2GB | 21.7GB |

- ixa は Shot ごとに違う文章を送るので、毎回「初めての文章」の分（テキストエンコーダ約 104 秒）が乗る。
  `economics` はそれを含めた値にしてある
- 峰のメモリが 22GB 前後あることが、**この機械で 2 本同時に作らない**（§6）理由の裏付けでもある
- 見た目の良し悪しは点を付けていない（人が決めること）。`qualities` で実測に基づくのは
  `characterConsistency` だけ

## やらないこと（今回）

- Wan A14B・VACE・Animate
- LoRA / scheduler / step 数 / 量子化を選ぶ画面（PF をモデル実験の GUI にしない）
- H3 と Wan の自動の品質判定、AUTO の routing（実測が揃ってから別のタスクで）
- 複数の GPU での並列実行、モデルのダウンロード管理、Draw Things の操作
- 最後のフレーム（`end_image`）。ixa に付ける画面がまだ無い（ADR-0031 と同じ）

## 次にやること

1. **ixa から実機で 1 本作る。** ここまでは契約テスト（モック応答）までで、ixa → wan-api の
   実通信は 1 度も通していない。`LOCAL_VIDEO_GENERATOR=vpipe,wan` にして
   「使う AI」で Wan を選び、最初のフレームから 1 本作る
2. H3 と Wan を同時に頼んで、**順番待ちになることを実機で見る**（§6 はユニットテストまで）
3. 実測が溜まったら AUTO の routing を決める（別のタスク）。いまのところ
   「速さ＝H3・開始画像の保ち＝Wan」なので、Shot ごとに人が選ぶ余地がある

## 追記（2026-10-07）: 実物の wan-api と突き合わせた

書き始めた時点では wan-api がコミット 0 だったため、vpipe-api v1 を正として組んだ。
実物が push された時点で突き合わせ、**食い違っていた 2 点を実物に合わせた。**

| | 仮に置いていたもの | 実物（正） |
|---|---|---|
| 投入の本文の項目名 | `duration_sec` | **`duration_seconds`** |
| 尺の上限 | 10 秒（H3 と揃えた） | **5 秒**（`/v1/capabilities` の宣言） |

**どちらも契約テストが落ちて気付いた形にしてある**（本文の形と尺の範囲を固定していたため）。
あわせて実物にしか無いものを取り込んだ。

- `timings`（サーバが測った秒数）を Take の記録と比較のログで正として使う
- `seed` の上限（2³¹−1）を投げる前に弾く
- `/v1/capabilities` を descriptor の正として明記（尺の範囲・大きさ・段はここが決める）
- `503 insufficient_storage` と `422 start_image_unsupported` が封筒で届くことを確認
- `economics` と `characterConsistency` を暫定値から実測へ差し替え
