# ADR-0057: 動画の Take は NG でも既定では作り直さず、作り直しを勧める

Status: Accepted
Date: 2026-10-23
Decider: Claude（Architect）

## 背景

制作者の要望（2026-10-23）: 動画の Take のレビューと自動の作り直し（上限 3 回）は、時間とトークンを多く使う。
既定の振る舞いを変えたい。

これまでの流れ（`apps/worker/src/review/processor.ts`）: Take のレビューが `fail` なら、**必ず** regeneration キューへ積み、
`canRegenerate` の上限まで作り直していた。作り直すかを選ぶ口は無かった。

## 決めたこと

### 1. 既定は作り直さず、勧めるだけ

レビューが `fail` でも、既定では作り直しを積まない。Take は不合格（`reviewStatus: failed`）のまま残り、画面に
「作り直し推奨」と出す。理由はレビューの指摘（findings）にあり、制作者は既存の口（自動レビューの欄で指摘を選び、
直しを添えて生成する。`POST /shots/{id}/generate` の `corrections`・`parentTakeId`）で作り直せる。

### 2. 頼むときに「NG なら自動で作り直す」を選べる

夜間に自走させる用。選んだときだけ、今までどおり上限つきで作り直す。

- 1 本ずつの生成: `POST /shots/{id}/generate` の `autoRetake`（画面はインスペクターの生成欄のチェック）
- まとめて本番で作り直す: `POST /projects/{id}/shots/bulk/remake-final` の `autoRetake`（画面は下見の欄のチェック）
- MCP: `generate_takes` の `autoRetake`（付けたら Shot ごとの口で頼む）

### 3. 選んだ値は頼んだ時点でジョブに残す

`generation_jobs.auto_retake`（既定 false）に残し、worker が Take を作るときに `takes.auto_retake` へ写す。
レビューは Take の値を見て決める。**後から全体の設定で変わらない**（同じ時間帯に頼んだ別の生成の選択に引きずられない）。
自動の作り直しで積むジョブは `auto_retake = true` を引き継ぐ（上限は `canRegenerate` が持つ）。

判断は domain の純粋関数に置く:

- `actionAfterReview({ verdict, autoRetake })` → `regenerate` / `recommend` / `none`
- `isRetakeRecommended(take)` → 不合格で、自動の作り直しを選んでいない Take（画面の印）

### 4. 画面の印

- Take のカード（Take 比較・インスペクター）: 「作り直し推奨」。説明に、理由の場所と作り直し方
- Shot 一覧: 採用中の Take が作り直し推奨なら、行に「作り直し推奨」（`GET /projects/{id}/shot-posters` の `retakeRecommended`）

### 5. 変えないもの

- 画像のチェックとやり直し（ADR-0055）
- 作り直しの上限・予算の判定（`canRegenerate`）と、直しの選び方（`decideRegenerationAdjustment`）
- 解像度を上げた Take は作り直しの対象にしない（`auto_retake = false`）

## 今回の外

- 一括の生成（`bulk/generate`）の口への `autoRetake`。MCP は `autoRetake` を付けたら Shot ごとの口で頼む
- 前からある Take は `auto_retake = false` になる（前の既定の「必ず作り直す」には戻さない）

## 追記（2026-10-23）: 自動の作り直しを選んだ Take は、自動でレビューもする（案 A）

レビューは人が頼んだときにしか走らないため、「NG なら自動で作り直す」を選んでも、夜間の自走では何も起きなかった。決めたこと:

- **旗オフ（既定）**: 生成の後に自動でレビューしない（今どおり）。人が頼んだレビューが NG なら、作り直さずに勧めるだけ
- **旗オン**: Take の取り込み（ポスターフレーム）が済んだら、worker がレビューを積む（`shouldAutoReview`。media の
  取り込みの後に積むのは、レビューがポスターフレームを見るため）。NG なら上限まで作り直し、作り直した Take も同じことを繰り返す。
  レビューは Take ごとに 1 つにまとめる（BullMQ のジョブ ID `auto-review-<Take>`）
- **上限まで全部 NG なら、最後の Take に「作り直し推奨」を残す。** 自動の作り直しが止まると Shot は `blocked` になる
  （既存）。`isRetakeRecommended(take, shotStatus)` は、旗オンでも Shot が `blocked` なら勧める。Take の一覧の API
  （`GET /shots/{id}/takes`）と Shot の絵の一覧が、Shot の状態と合わせて `retakeRecommended` を返す
- 画面の「生成のあとに自動レビューをするか聞く」は、旗オンの Take を数えない（worker が積むので、重ねて払わない）
- **MCP に `review_take` を足す。** 旗オフのとき、エージェントが自分で確かめられるように。結果は `wait {kind:"review", id: takeId}`
  で、判定・費用・指摘（直し方つき）を返す
- レビューの費用は今の記録（`ReviewRun.costUsd`）のまま

