# ADR-0059: Shot にセリフの行を持たせ、セリフのある Shot だけ H3 に音付きで頼む

Status: Accepted
Date: 2026-10-26
Decider: Claude（Architect）

## 背景

制作者の要望（2026-10-26）: しゃべる動物のコント（9:16・60〜90 秒・14 Shot 前後）を ixa で作りたい。
会話劇の計画（段 1〜4）のうち、これは段 1「Shot にセリフを持たせる」。Take の音を書き出しまで残すのは段 2（ADR-0060）、
2 段字幕は段 3（ADR-0061）。

調べて分かったこと:

- `shots.dialogue` は text の列だったが、使っている行は 0 件（1353 行）。PATCH で直せず、H3 にも渡っていなかった。
  文字列 1 本では、誰が言うのか・画面の外の声かが分からず、H3 の公式の書き方に組めない。
- H3 のプロンプトは v3 で、音の欄にいつも「Nobody speaks」と書いている（人物のアップで口パクが出たため。ADR-0042 の後の直し）。
- プロンプトはキャラクターの名前を知らない（`compileSpec` が持ち込むのは見た目の語だけ）。
- vpipe には音の指定が無く、記録に `audio:false` と決め打ちしていた。

## 決めたこと

### 1. セリフは行の配列（`DialogueLine`）

`{ speakerId, text（1〜200 字）, offscreen, translation }`。`Shot.dialogue` は `DialogueLine[]`（既定 `[]`）。

- 話し手は作品のキャラクター。**配役にいなくてよい**（画面外の声）。同じ作品のキャラクターでなければ 422。
- 1 Shot 20 行で止める（書き間違いで文面の上限を超えるのを保存の時点で止める）。
- 5 行以上は `dialogueWarnings` で「長すぎます（10 秒に 3〜4 行まで）」と言うだけで、止めない。
  API の Shot の応答・MCP の結果・画面が同じ関数（domain）の結果を出す。
- `translation` は段 3 の 2 段字幕で使う。マイグレーションを 1 回で済ませるため、先に持たせた。

### 2. キャラクターに「英語の呼び名」と「声の説明」と話し手の番号

- `speechName`（例 `The cat`）と `voiceDescription`（例 `a soft, sly, teasing young woman's voice`）。
  **H3 の文に一字一句そのまま入れる。** Shot ごとに言い換えると、H3 は別の声として作り、同じ人の声が Shot ごとに変わる。
- `speakerNo`: 作品の中で作った順に 1, 2… と振る固定の番号。H3 の話し手の印（`S1`, `S2`…）になる。
  **消しても詰めない・使い回さない**（論理削除の行も数える）。振るのはリポジトリの INSERT だけで、
  作成の入力にも PATCH にも無い。`(project_id, speaker_no)` の一意索引で重ねない。
- 話し手に呼び名か声の説明が無ければ、**Take を作る前に**理由（「セリフの話し手「ネコ」に英語の呼び名がありません」）
  を添えて止める（api は 422、worker はジョブの失敗）。画面のセリフの欄にも同じ文を先に出す。

### 3. 仕様にはセリフのある Shot だけキーを置く

`promptParts.dialogue = { lines: [{ speakerTag, speechName, voiceDescription, text, offscreen }], onScreen: [{ speakerTag, speechName }] }`。

- `onScreen` は Shot の配役のうち、英語の呼び名がある人（名指しできない人は入れない）。
- **セリフの無い Shot はキーを書かない**（`corrections` と同じ理由）。既存の Take の specHash は 1 バイトも変わらない
  （BASELINE のハッシュを確かめるテストを置いた）。
- 画面外の話し手は配役にいないので、`GenerationContextSource.speakersForShot` を足して行から引く。
  **api と worker が同じ口を読む**（違うと spec_drift で落ちる）。
- 最初のコマ（絵）の指示文はセリフを見ない。静止画に声は無く、話し手がそろうまで絵まで作れなくなるため。
- 持ち込みの Take の仕様にもセリフを入れない（声も含めて動画のまま使う）。
- `spec.prompt`（共通の連結）にはセリフを足さない。セリフを文に組むのは H3 だけ（下の 4）。

### 4. H3 の版 `h3-official-v4-dialogue`

**セリフのある Shot だけ v4。無い Shot は v3 のまま**（v3 のゴールデンは変えない）。

- 話し手: `The cat in a soft, sly, teasing young woman's voice (S2) says: <d>[Japanese] ねえ、ネズミくん。</d>`
- 画面外の話し手: `… (S1) says in an off-screen voiceover: <d>[Japanese] …</d>`
- しゃべっていない映っている人: 行ごとに `The mouse's mouth stays closed.`
  （画面外の行では、映っている人は全員。話し手が配役にいても、声は画面の外から届くため）
- セリフの文は、カット説明・mood・直しの後、カメラの動きの前に置く。
- 音の欄: `overall_soundscape: Only the dialogue and the ambient sound of the scene.`（「Nobody speaks」は書かない）
- 版の選び方は `h3PromptFormatFor(spec)`（`promptParts.dialogue` があれば v4）。

### 5. vpipe は音付きで頼み、頼んだ値を記録する

- 本文の `audio: true` は**セリフのある Shot だけ**付ける。無い Shot はキーごと省く（本文は前と同じ）。
- 投入の控え（submit note）に「音付きで頼んだか」を残し、記録の `audio` と版（v3/v4）はそこから引く
  （`poll` には仕様が来ない）。v4 と音付きは同じ条件で決まる。前の控えには無いので `false`（そのころは頼んでいない）。
- descriptor の `audioGeneration` は「セリフのある Shot だけ音を作れる」の意味で true にした。
  能力の検査に「セリフ（声）を作れない」を足し、音を作れないモデル（Wan・fal・スタブ）ではセリフのある Shot を作らない
  （作ると声の無い口パクの Take が黙ってできる）。AUTO はセリフのある Shot で音を作れるモデルだけを選ぶ。
- 受け取った mp4 はそのまま保存する。音のトラックがあれば probe が `hasAudio: true` を付ける。鳴らすのは段 2。

### 6. 書ける場所

- API: `PATCH /shots/{id}` と Shot の作成の `dialogue`、`POST /projects/{id}/storyboard/cuts` の `dialogues`
  （カットの数と同じ長さ。重なって飛ばしたカットがあっても、残ったカットに正しい行が付く）、
  キャラクターの作成と PATCH の `speechName`・`voiceDescription`。
- 画面: Shot のインスペクターの「セリフ」欄（参照の次）。話し手は配役の人を先に、配役にいない人を後に並べる。
  キャラクターのインスペクターの「セリフの声」。
- MCP: `edit_shots` の `dialogue`（丸ごと置き換え）、`plan_shots` の `dialogues`、`edit_character` と
  `create_character` の `speechName`・`voiceDescription`、`restructure_shots` の insert の `dialogue`（行の配列に変えた）。
- 自動レビューの指示文のセリフは「話し手: セリフ」の行にする。

### 7. マイグレーション 0056

- `shots.dialogue` を jsonb の配列（既定 `[]`・NOT NULL）にする。中身のある文字列の行が残っていれば止める
  （話し手の分からない文字列を黙って捨てない）。
- `characters` に `speaker_no`・`speech_name`・`voice_description`。既存のキャラクターには、作品ごとに作った順
  （`created_at`, `id`）で番号を振る（論理削除の行も数える）。

## 分かっている不足

- セリフの字幕はまだ出ない（段 3）。Take の音もまだ鳴らない・書き出しに出ない（段 2）。
- 言語は日本語だけ（`[Japanese]` で決め打ち）。
- 映っていても英語の呼び名が無い人は、口を閉じさせる文に入らない（名指しできない）。
- Shot を分けると、セリフは前半に残り、後半は空で始まる（両方に写すと同じセリフを 2 度しゃべる）。
  どの行が後半に入るかは分からないので、分けたあとに手で移し替える。
- セリフの行の取り消し（⌘Z）は、Shot のほかの欄と同じく丸ごと戻す。
