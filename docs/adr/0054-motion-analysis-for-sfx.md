# ADR-0054: Take の動きを分析して、効果音を映像に合わせる

Status: Accepted
Date: 2026-10-19
Decider: Claude（Architect）

## 背景

制作者の要望（2026-10-19）: 効果音は映像に合わせたい。スキールはドリフトの間ずっと、バックファイアは瞬間に、
跳ねる足音は着地ごとに鳴らす。UI からも MCP からも、Take があれば**まず分析して見せ、それから具体的な指示で作る**。

ADR-0052 の効果音は「鳴らす時刻は ixa が決める」と決めたが、案（`suggestSfxCues`）はエフェクトとトランジションしか
見ておらず、映像の中身は見ていない。宣伝動画（TT-03・TT-05・TT-07）では手作業で合わせた
（ffmpeg で灰色の rawvideo を抜き、隣のコマとの差＝動きの強さと、跳ねるキャラの靴の y 座標から着地を取る）。
「足音完璧」と好評だった。これを汎用の仕組みにする。靴の色を追うのは汎用にならないので、
**動きの強さの山**＋**Claude にコマを見せて何が起きているかを判断させる**＋**AI の時刻を山に寄せる**で作る。

## 決めたこと

### 1. 分析は Take ごとに 1 回。結果は追記のみの表に残す

表 `take_motion_analyses`（追記のみ）。列は take_id・analyzer_version・status（`succeeded` | `failed`）・
energy_hop_sec・energy（double の配列）・onsets（jsonb）・events（jsonb）・vision_used・cost_usd・failure_message。

- **同じ Take・同じ版で成功した行があれば作り直さない。** ただし AI で中身を見ていない行（`vision_used = false`）は、
  文章の AI が Claude に替わっていれば作り直す（見られるようになったのに山だけの結果を使い続けない）
- 失敗も行として残す（理由は画面に出せる日本語）。作り直しは新しい行。いちばん新しい行が今の結果
- 時刻はすべて **Take の秒**で持つ。タイムラインの秒は読むときに Shot から計算する（使い始め・速さが後から変わるため）

### 2. 動きの強さと山（domain の純粋関数）

- worker が ffmpeg で **12fps・64×36・灰色**の rawvideo を抜き、隣のコマとの差の平均（0〜1）を動きの強さの列にする。
  12fps にするのは、手元の動画 AI の出力が 24fps の箱に 12 コマを 2 回ずつ入れているため（24fps で差を取ると 1 つおきに 0 になる）
- `detectOnsets`: 前後 0.5 秒の中央値を引いた「急に増えた分」の極大を山とする。
  最大の 20%（かつ 0.003）に満たないものは捨て、0.15 秒より近い山は強い方を残す。
  カメラが動き続ける Shot では強さ全体が底上げされるので、絶対値ではなく前後との差で取る
- `sustainedSegments`: 強さが閾値を超え続ける区間（続く音の目安）
- 宣伝動画 TT-07 の試算で、手で置いた着地 8 回（boing 4・tap 4）がすべて ±0.1 秒以内の山に当たった

### 3. 何が起きているかは Claude が見る

- worker は Take を等間隔に **12 コマ**抜いて 4×3 の 1 枚の帯（tile）にし、各コマの時刻を文で添える
  （ffmpeg に文字を描く機能が無い build のため。計画の 8 コマから増やした: 7 秒の Take だと 8 コマでは 0.9 秒おきになり、跳ねる動きが読めない）
- Claude CLI に帯の画像・山の時刻と強さ・Take の長さ・Shot の説明を渡し、出来事の一覧を JSON で返させる。zod で検査する
  （`claude-cli-reviewer.ts` と同じ作り。画像はファイルパスで渡し Read だけを許す。cost を記録する）
- 出来事の種類は 4 つ: **瞬間**（`moment`。衝撃・着地・バックファイア）、**続く音**（`sustained`。スキール・エンジン・水しぶき）、
  **通り過ぎ**（`pass_by`。風切り）、**環境音**（`ambient`）。各出来事は Take の秒の時刻と長さ・日本語の名前・英語の音の指示・確からしさを持つ
- `snapToOnsets`: **瞬間だけ**を、前後 0.25 秒以内の最も近い山に寄せる（AI はコマの粗い帯しか見ていないので時刻が甘い）。
  近くに山が無ければ AI の時刻のまま
- 文章の AI が Claude 以外なら AI の判定を飛ばし、山をそのまま「瞬間」の案にする。行に `vision_used = false` を残し、
  画面に「AI で中身を見ていない」と出す（飛ばしたことを隠さない）

### 4. タイムラインの秒と効果音のきっかけ

- `takeSecToTimelineSec(shot, takeSec, takeDurationSec)` = `shot.startSec + (takeSec − sourceInSec) / shotPlaybackRate`。
  Shot に映る範囲の外は null（その出来事は落とす。続く音は映る範囲に切り詰める）
- `motionEventsToSfxCues`: 続く音は **10 秒以内に分けて並べ、つなぎ目を 0.25 秒重ねる**（sfx-api の上限が 10 秒）。
  0.5 秒未満は 0.5 秒にする
- `suggestSfxCues` は動きの出来事も材料にする（エフェクト・トランジションからの案と並べる）

### 5. 口

- キュー `motion`（同時 1 つ。ID だけを積む）。API の `POST /takes/{id}/motion-analysis` が積み、
  `GET /takes/{id}/motion-analysis` が結果（と待ち・作業中）を返す。`GET /shots/{id}/motion-analysis` は採用中の Take の結果を
  タイムラインの秒に直して返す
- web: 「効果音を作る」窓。分析を読み、無ければ走らせる。動きの強さの波と出来事の印、提案の一覧（直せる）から
  既存の `POST /projects/{P}/sfx/generate` へ送る
- MCP: `analyze_motion`（Shot か Take。待って結果を返す）。`suggest_sfx` に動きの案を混ぜる。
  `generate_sfx` の説明は「分析 → 案を直す → 頼む」の順にする

## 今回の外

- 左右の足の見分け、物の追跡（靴の色を追うなど作品ごとの手法）
- 映像から音を作るモデル（ADR-0052 の「今回の外」のまま）
- Claude 以外の AI でのコマの判定（Codex・Grok は文章だけ）

## 分かっている不足

- Claude の判定は 1 回に数十秒かかり、契約の利用枠を使う。Take ごとに 1 回で、結果は残して使い回す
- カメラが動き続ける Shot（TT-03 の江戸の通り）では、足音より画面全体の動きが強く、山が足音とずれることがある。
  AI の判定と寄せる幅（0.25 秒）で補うが、手で直す前提の案である

## 追記（2026-10-19）: 実地テストを受けて — 分析を複製で写す・音の山で合わせる

宣伝動画の効果音を作り直した実地テストで、2 つの手戻りが分かった。制作者の了承を得て直す。

### 1. 作品を複製したら、動きの分析も写す

複製すると Take の ID が新しくなるので、分析を使い回せず、Shot ごとに約 0.34 ドルを払い直していた。

- 複製で Take を写すとき、元の Take の**最新の成功の行**を、新しい Take の ID で `take_motion_analyses` に写す
  （`copyMotionAnalysisInput`。`duplication-copy.ts` の他の写し方と同じ純粋関数）
- 写した行の費用は 0（この作品では払っていない。Take の `copiedFromTakeId` と同じ考え）。失敗の行は写さない
- 表は変えない。ほかの作品からの読み込み（ADR-0053）は Take を写さないので対象外

### 2. 効果音は、音の一番大きいところを出来事の時刻に合わせる

風切りは鳴り始めから山まで最大 0.7 秒あり、出来事の時刻を音の頭にすると遅れて聞こえた（足音は 0.01 秒で問題ない）。

- きっかけ（`SfxCue`）に省略できる印 `align: { to: 'peak', notBeforeSec }` を足す。付いたきっかけの `startSec` は
  **山を鳴らしたい時刻**を表す。`motionEventsToSfxCues` が、瞬間と通り過ぎにだけ付ける（続く音・環境音は鳴り始めで置く）。
  `notBeforeSec` はその Shot の始まり
- worker ができた WAV で、鳴り始めから一番大きいところまでの秒を測る（10 ms の窓の RMS が最大の窓の中の最大のサンプル）。
  無音・読めない形式は null。1 本ずつの値を `providerRecord.peakOffsetsSec` に残す（表は変えない。種と同じ置き方）
- 置く時刻は domain の `sfxClipStartSec` の 1 か所で決める: 印があり山が測れていれば `max(0, notBeforeSec, startSec − 山の秒)`、
  それ以外は `startSec`。画面の「効果音を作る」窓も MCP も、案の印をそのまま頼みに渡すだけで、同じ規則で置かれる

## 追記（2026-10-19）: 動きの分析の Claude を Sonnet にする

制作者の了承で、分析の費用を下げるため、コマの帯を見る Claude を Sonnet にする（画像のチェック・ADR-0055 と同じ形）。

- 環境変数 `MOTION_ANALYSIS_MODEL`（既定 `claude-sonnet-5-5`）。`packages/config` の zod で、英数字と `.` `-` `_` だけを受ける
- **モデル ID で書く。** 別名 `sonnet` はこの Mac の Claude Code の設定で Opus に向いている（ADR-0055 の実測）
- `--model` は動きの分析の呼び出しにだけ渡す（レビュー・下書きなど、ほかの Claude CLI の呼び出しは変えない）
