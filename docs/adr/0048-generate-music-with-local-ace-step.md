# ADR-0048: 手元の ACE-Step 1.5 で曲を作る（ace-step-api）

Status: Accepted
Date: 2026-10-17
Decider: Claude（Architect）

## 背景

楽曲は今まで、制作者が持ってきた音源を取り込むだけだった。仮の曲・別案の曲を試すたびに外で作って取り込み直している。
vpipe・klein と同じ Mac の GPU で **ACE-Step 1.5** が動くので、ジョブ式のサーバ **ace-step-api**（別リポジトリ）を挟んで
ixa から頼めるようにする。ACE-Step 1.5 の重みとコードは **MIT ライセンス**。

実測（対象の Mac。2026-10-17）: 60 秒の曲で初回 58〜93 秒（モデルの読み込み込み）、2 回目からは 33〜34 秒（1 曲 40 秒ほどを目安にする）。
出力は PCM16・48kHz・ステレオで、長さは頼んだとおり。**同じ seed でも同じ曲にはならない**ので、画面で再現を約束しない。

## 決めたこと

### 1. 契約は klein-api と同じ v1 のジョブ式

`GET /v1/health`・`GET /v1/capabilities`・`GET /v1/workflows`・`POST /v1/workflows/ace-step-1.5/jobs`・
`GET /v1/jobs/{id}`・`GET /v1/jobs/{id}/output?index=N`・`DELETE /v1/jobs/{id}`。Bearer・`Idempotency-Key`・
429 + `Retry-After`・失敗の封筒も同じ。既定の口は `http://127.0.0.1:8768`。

投入の本文: `prompt`（曲調のタグ 1〜1000 字）・`lyrics`（〜4000 字。空は歌詞なし。`[verse]` `[chorus]` 可）・
`duration_sec`（10〜240）・`instrumental`（true なら歌詞は使わない。ixa は空で送る）・`seed`（省略可）・`count`（1〜4）。
出来上がり: `result.outputs[]` に `{ index, media_type: 'audio/wav', duration_sec, seed_used }`、
各 `output?index=i` がステレオの WAV。**欠けた番号・頼んだ数より少ない成功は失敗にする。**

### 2. 「使う AI」に曲を足す

用途 `music`（曲）。選べるのは `ace_step` とお試し。**お試しは曲を作らない**（頼むと 409 で「曲の AI を選んで」と言う）。
`LOCAL_MUSIC_GENERATOR=ace_step` と書いたときだけ ace-step-api の health を見る（URL やトークンの有無で切り替えない）。
`ai_settings.music_tool` は既定 `stub`（既にある 1 行を読めなくしない。ADR-0038 と同じ）。

### 3. ジョブとできた曲

`music_jobs`（追記のみ）に指定と状態を持つ。API はジョブを作って `music` キューへ入れるだけで、作るのは worker。
できた曲は 1 曲ずつ素材（`origin: generated_music`）→ 楽曲 → `analysis` キュー。
**マスターは作品にマスターが無いときの 1 曲目だけ**（制作者が選んだ曲を黙って替えない）。
状態は `music_job.status` で画面へ流す。

### 4. GPU は動画・高画質化・絵と同じ整理券

worker の整理券（ADR-0040）に並ぶ。並び方は絵と共通の `generation/local-gpu-turn.ts`。
順番が来ていなければ積み直し、処理枠を握らない。止める・諦めるときは生成先も止める。

## 今回の外

- **ace-step-api の契約は ixa 側で先に固めた。** 出来上がりの `media_type` と `duration_sec` の名前、
  投入の URL（`/v1/workflows/ace-step-1.5/jobs`）は、サーバができたら突き合わせる（違えば契約テストを直す）
- お試しで仮の音（ffmpeg の音）を作る口は作らない。曲の AI を選ばせる
- 費用の表示・予算には入れない（手元の GPU で 0 円）
- 種（seed）は API では受けるが画面には出さない（同じ種でも同じ曲にならないため）
- 仕上がりを待つ上限は投入から 15 分（GPU の順番待ちは別に 2 時間まで）
- 参照音源（似た曲を作る・続きを作る）・歌声の指定・区間の作り直しは未対応

## 追記（2026-10-19）: 歌なし BGM の AI として Stable Audio 3 Medium を足す

曲の AI に `stable_audio_medium_music`（モデル `sfx_api/stable-audio-3-medium-music`）を足す。
効果音と同じ sfx-api（ADR-0052）の別の workflow で、同じ待ち行列・同じ合言葉。`LOCAL_SFX_GENERATOR=sfx_api` で有効になる。
ACE-Step は残す。**BGM の既定は Stable Audio**（制作者 2026-10-19）: 勧める順の先頭を Stable Audio にし、
保存済みの「使う AI」の曲も Stable Audio に切り替えた。

新しい環境の初期値（`aiDefaultsFromEnv`）も曲は Stable Audio にする（手元・無料なので、選ぶ前でもお金は掛からない）。

**歌あり（`instrumental: false`）の頼みは、ACE-Step が使えればそちらで作る**（制作者 2026-10-19。振り分けは
domain の `decideMusicTool` 1 か所）。「使える」は `.env` で ace-step-api を有効にしているか（health は見ない。
止まっていれば worker がそう言って失敗する）。使えないときだけ 409 で「歌なしにするか、歌える AI を選ぶ」と言う。
歌詞だけ付いた歌なし・190 秒を超える歌なしは回さずに断る（回しても歌なしの頼みは変わらない）。
画面は Stable Audio を選んでいれば歌なしで始め、歌ありにすると歌詞の欄を開いて「歌ありは ACE-Step 1.5 で作ります」と出す。

- **歌は作れない。** 歌を黙って捨てない。規則は domain の `musicSpecProblem` と `decideMusicTool` で、
  MCP の説明にも書く。Provider も歌あり・歌詞ありを送る前にもう一度止める
- 長さは 10〜190 秒（サーバは 0.5 秒から受けるが、曲のジョブの下限 10 秒に合わせる）。上限の正はサーバの `GET /v1/capabilities`
- 本文は効果音と同じ形（説明・長さ・数・種）。「TrackType: Music, VocalType: Instrumental, 」の前置きはサーバが付ける（ixa は付けない）
- 出力は PCM16・44.1kHz・ステレオの WAV で、頼んだ長さちょうど

## 追記（2026-10-19）: MiniMax-Music3 を足し、振り分けを AI が増えても崩れない形にする

曲の AI に `minimax_music3`（モデル `ace_step/minimax-music3`）を足す。ace-step-api（6681bcf）の別の workflow で、
本文は ace-step-1.5 とまったく同じ。`LOCAL_MUSIC_GENERATOR=ace_step` で ACE-Step と一緒に有効になる。
既定・勧める順・`aiDefaultsFromEnv` は替えない（制作者に確かめてから）。

- **名前の表記。** MiniMax-Music3 Community License は製品の画面に「MiniMax-Music3」を目立つように出すことを求める。
  「使う AI」の名前は `MiniMax-Music3` のままにし、説明（notice）にライセンス名を書く。「曲を作る」の窓にも名前と説明を出す
- **長さは上限。** 曲が早く終わることがある（62 秒を頼んで 22.9 秒の例）。楽曲の長さは取り込みで測ったものを使う（今までどおり）
- **とても遅い。** 曲 1 秒あたり約 9 秒（60 秒の曲で約 10 分）で、進み具合が 0.95 で止まったまま見積もりを超えることがある。
  待つ上限をモデルごとに持たせ（`MusicModelDescriptor.maxWaitSec`）、MiniMax は 3 時間（240 秒 × 4 曲でも収まる）。ほかは今までの 15 分
- 実際に歌なしで作ったか（`details.generation.instrumental`）は記録（`providerRecord.details`）に残す
- ace-step-api の health は workflow ごとに見る（片方のエンジンが使えなくても、もう片方は使える）。
  見方は sfx-api と同じなので、`checkWorkflowHealth` に寄せて両方が使う
- メモリを 24GB 使う。動画と同じ整理券（`local-gpu`）に並ぶので、worker の中では動画と同時には動かない

振り分け（`decideMusicTool`）は表で決める:

- 曲を作れる AI は `MusicAiToolId` に並べ、歌えるか・長さを `LIMITS` に必ず書く（足し忘れはテストが落とす）
- 歌える AI は `MUSIC_VOCAL_FALLBACK_ORDER`（速い方から: ACE-Step → MiniMax-Music3）に必ず入れる（同じくテストが見張る）
- 歌なしだけの AI に歌ありが来たら、この順で使えて作れる最初の AI へ回す。どれも使えなければ選んだ AI の理由で 409
- **歌詞が空の歌ありは歌なしとして扱う**（`normalizeMusicSpec`）。どちらのエンジンも歌詞が空なら歌なしで作る
  （`empty_means_instrumental`）ので、記録もそれに揃え、回さない。画面は「歌を入れる／入れない」をどの AI でも選ばせ
  （既定は入れない）、歌を入れるのに歌詞が空なら頼む前に止める

