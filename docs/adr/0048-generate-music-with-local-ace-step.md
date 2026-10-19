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

歌詞・ボーカルが要る頼みは、**黙って ACE-Step へ回さない**（選んでいない AI で作ると、待ち時間も出来も
予想と違うものが届き、ACE-Step が止まっていれば理由も分からない）。API は 409 で「歌なしにするか、
『使う AI』で歌える AI を選ぶ」と言い、画面は Stable Audio を選んでいる間「歌なし」を固定して歌詞の欄を閉じる。
歌を作るときは制作者が「使う AI」の曲を ACE-Step に替える。

- **歌は作れない。** 歌あり・歌詞ありの頼みは黙って捨てずに断る。規則は domain の `musicSpecProblem` 1 か所で、
  API は 409 で理由を返し、画面は「歌なし」を固定して歌詞の欄を閉じ、MCP の説明にも書く。Provider も送る前にもう一度止める
- 長さは 10〜190 秒（サーバは 0.5 秒から受けるが、曲のジョブの下限 10 秒に合わせる）。上限の正はサーバの `GET /v1/capabilities`
- 本文は効果音と同じ形（説明・長さ・数・種）。「TrackType: Music, VocalType: Instrumental, 」の前置きはサーバが付ける（ixa は付けない）
- 出力は PCM16・44.1kHz・ステレオの WAV で、頼んだ長さちょうど
