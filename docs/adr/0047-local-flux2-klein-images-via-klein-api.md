# ADR-0047: 手元の FLUX.2 [klein] を klein-api 経由の画像 Provider として足す

Status: Accepted
Date: 2026-10-16
Decider: Claude（Architect）。制作者の選択（2026-10-16「Mac で Klein 9B による画像生成が出来るようになった。ixa からも使えるようにしたい」「klein-api リポジトリを新しく作って連携しながら実装を進めて」）

## Context

画像の口は Codex CLI（ADR-0029）とお試しだけ。Codex は 1 枚 70 秒前後で、seed を持たず、
契約の利用枠を使う。制作者は新Mac（M5・32GB）で **FLUX.2 [klein] 9B** を Draw Things の
`draw-things-cli` から動かせるようにした（新Mac の iris-api セッションの実測、2026-10-16）:

- 1024×1024・4 step で 1 枚 25.9 秒（毎回起動）。4B なら 14.1 秒
- seed で同じ絵が出る（Codex には無い）
- メモリのピークは 10GB 以上（重みは合わせて 17.6GB）。**vpipe-api（H3・FlashVSR）と同じ Mac**

CLI は HTTP の口を持たない。ixa の worker は別の Mac で動くので、ジョブ式のサーバで包む必要がある。

## Decision

### 1. 生成サーバは別リポジトリ klein-api（契約の正は向こうの `docs/api.md`）

wan-api（ADR-0040）と**同じ v1 の流れ**: `GET /v1/health`・`GET /v1/capabilities`・
`POST /v1/workflows/flux2-klein/jobs`・`GET /v1/jobs/{id}`・`GET /v1/jobs/{id}/output?index=N`・
`DELETE /v1/jobs/{id}`。失敗の封筒・429 + `Retry-After`・`Idempotency-Key`・Bearer も同じ。
既定の口は `http://127.0.0.1:8767`。

違うのは本文と出力だけ:

| field | 内容 |
|---|---|
| `prompt` | 1〜4000 文字 |
| `output` | `{width, height}`。サーバが作れる大きさ（約 1MP・64 の倍数）で作り、cover + 中央切り抜きで合わせる |
| `quality` | `draft` / `standard`。**モデル（4B / 9B）・step・CFG は送らない**（wan と同じく段だけ） |
| `seed` | 画像 *i* は `seed + i` |
| `count` | 1〜4。1 つのジョブの中で順に作る |
| `reference_images` | 0〜`capabilities.reference_images.max` 枚 |

`negative_prompt` は**受けない**（422）。CFG=1 の蒸留モデルでは効かず、受けると黙って無視することになる。

### 2. Provider `klein`・モデル `klein/flux2-klein`（standard だけ）

- 置き場は `packages/providers/image/src/klein/`。HTTP・冪等キー・出力の取り込みは
  **`@ixa/provider-video` の `local-server/` の部品を使い回す**（provider 同士の import は境界の規則で許されている）。
  vpipe の高画質化（`vpipe/upscale.ts`）も同じ使い方をしている。3 つ目の使い手が出たら独立のパッケージへ出す
- 画像の口は「使う AI」の 1 つに 1 モデル（ADR-0032）なので、**ixa が使う段は standard（9B）だけ**。
  draft（4B）はサーバにあるが、ixa では選ばせない（画面に段の選択が無い）
- 作る形は Codex と同じく向きごとに 1 つ（横 1344×768・縦 768×1344・正方形 1024×1024）。
  比への切り抜きは今までどおり worker（`crop.ts`）
- 参照画像は**2 枚まで**。新Mac の実測（2026-10-16）で `--image` は FLUX.2 の参照として効いた（顔・服が保たれる）。1 枚で約 2 倍・2 枚で約 2.8 倍の時間。3〜4 枚は未実測なので宣言しない。strength を 1 未満にすると img2img の下絵になる（klein-api は渡さない）
- 費用 0。**スタブ扱いにしない**

### 3. 「使う AI」に `klein`

`AiToolId` に `klein` を足す（画像だけ）。見つけ方は `local_server`（`GET /v1/health`）。
勧める順は **Codex の次**（実測が揃うまで初期値を変えない）。

### 4. 設定は明示の切り替え

- `LOCAL_IMAGE_GENERATOR=none|klein`（既定 `none`）。`LOCAL_VIDEO_GENERATOR` と同じ書き方
- `KLEIN_API_URL`（既定 `http://127.0.0.1:8767`）・`KLEIN_API_TOKEN`
- 外を指しているのにトークンが無い・トークンの形が違う、は起動時に止める。**規則は vpipe・wan と 1 つの表**
  （`packages/config/src/local-video.ts`。表の鍵を「手元の生成サーバ」に広げる）

### 5. GPU は動画と同じ列に並ぶ（整理券）

klein-api は vpipe-api と同じ Mac の GPU とメモリを使う。**絵のジョブも `local-gpu` を名乗り、
動画・高画質化と同じ整理券（`local-gpu-lease.ts`）に並ぶ。**

- 順番が来ていなければ**その場で待たずに積み直す**（券は `queuedAt`。先頭なら 10 秒、後ろなら 1 分後）。
  待つ間 worker の処理枠を握ると、GPU を使わない Codex の絵まで止まり、停止も遅れる。待っている間ジョブは queued のまま
- 借りている間は 1 分おきに延ばす。終わったら（失敗・取り消しでも）返す
- **諦めるとき（時間切れ・問い合わせが続けて失敗）は、返す前に生成先を止める。** 止めずに返すと、
  向こうの生成があとから走り出して次の動画と同時に GPU を使う。1 回だけの通信の失敗では諦めない（3 回続いたら）
- 2 時間待っても順番が来なければ、理由を言ってやめる（絵は 1 枚 30 秒前後なので、
  それだけ待たされるのは動画の長い列の後ろにいるとき）

**ixa の列だけでは足りない**: 制作者が vpipe-api を直接使うこともある。klein-api 側も、
始める前に vpipe-api の `GET /v1/health` が 30 秒あけて 2 回とも空であることを確かめる
（klein-api の `coordinate_with`。新Mac の実測で衝突 0 回だった方法）。毎回 30 秒待つと 1 枚の時間がほぼ倍になるので、
2 回目の確認は**直前 30 秒以内に vpipe-api が忙しかったのを見たときだけ**にした。

## 分かっている不足

- **大きさは約 1MP。** 16:9 の最初のフレームは 1344×756 になる（Codex は 1536×864）。
  9B で 2MP が通るかは実測待ち
- 常駐（gRPCServerCLI）にすれば 1 枚 6 秒ほど縮むが、既定で 0.0.0.0 に認証なしで開くので今回は使わない
