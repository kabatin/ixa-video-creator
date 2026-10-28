# ADR-0066: 絵と Take の Claude のチェックは切り替えにし、既定は切る

Status: Accepted
Date: 2026-10-28
Decider: Claude（Architect）
Supersedes: ADR-0055 §2 の「テキストが Claude なら必ず見る」

## 背景

制作者の要望（2026-10-28）: 「画像のチェックも動画のチェックもトークン消費激しすぎるから、切り替え可能にしてデフォルトは OFF にしよう」。

これまでは、「使う AI」のテキストが Claude（`claude_cli`）なら、次の 2 つが**必ず**走っていた。

- **絵のチェック**（ADR-0055）: 最初のフレーム・キャラクターシート・キーアートを 1 枚描くごとに Claude CLI に見せ、
  手元の AI なら「やり直す」で上限まで描き直す（`apps/worker/src/image/check-step.ts`）
- **Take のチェック**: Take のレビュー（ADR-0005）の Stage 2。identity・continuity・composition・prompt_adherence を
  Claude CLI に画像で見せる（`createChosenVisionReviewer`。`apps/worker/src/review/chosen-reviewer.ts`）。
  人が頼んだレビューと、自動の作り直しを選んだ Take の自動レビュー（ADR-0057 追記）の両方が通る

どちらも制作者の契約の利用枠を使い、止める口が無かった。

## 決めたこと

### 1. 「使う AI」に 2 つの切り替えを持つ。既定は切る

- domain: `AiSettings.checks = { image: boolean, video: boolean }`（`AiChecks`。`packages/domain/src/ai/ai-checks.ts`）。
  **省けば切る**（`.default(AI_CHECKS_OFF)`）。チェックを知らない前の画面・MCP から保存しても、勝手に入れない
- DB: `ai_settings.image_check` / `video_check`（`boolean NOT NULL DEFAULT false`。マイグレーション `0059_ai_checks.sql`）。
  既定値が無いと既にある 1 行が NOT NULL を満たせず、既定が true だと列を足しただけで利用枠を使い始める
- 行が無い（まだ選んでいない）とき・勧める組み合わせ（`recommendAiSettings`）・環境変数の初期値（`aiDefaultsFromEnv`）は、どちらも切る
- **既にこの環境で Claude を使っている人も、マイグレーションの後は切れた状態になる**（制作者の要望どおり）。入れ直すのは画面か MCP

### 2. Claude で見るかの規則は 1 か所（`aiCheckGate`）

```
切っている            → off（見ない）
入れていて Claude でない → not_claude（見ない。画像を見られる口は Claude CLI だけ。ADR-0055 のまま）
入れていて Claude      → claude（見る）
```

worker はジョブのたびに設定を読む（テキストの AI と同じ。画面で切り替えたら次の 1 枚・1 本から効く）。

- 絵: `off` なら Claude に見せず、`outcome: skipped`・「「使う AI」で絵のチェックを切っているため、チェックしていません。」を残して当てる。
  `shouldAutoRetry` は `checked` しかやり直さないので、描き直しも積まない
- Take: `claude` のときだけ Claude のレビュアで判定し、それ以外はお試しのレビュア（費用 0。テキストが Claude でないときと同じ）

### 3. 切り替えの口

- 画面: 「使う AI」のダイアログの下に「Claude のチェック」（「描いた絵をチェックする」「Take をチェックする」）。
  横に「1 枚描くごと / Take 1 本ごとに Claude の利用枠を使う」と書き、テキストが Claude でなければ「いまは入れても働きません」と言う
- API: `PUT /ai/settings` の本文の `checks`（zod は domain の `AiSettings`。真偽以外・片方だけは 422）
- MCP: `set_ai` の `imageCheck` / `videoCheck`（片方だけでも可。指定の無い方は今の値のまま）。`ixa_status` の `aiSettings.checks`

### 4. 変えないもの

- 決まった規則で測るレビュア（technical・music・brand）。Claude を使わないので切り替えに関わらず走る
- 動きの読み取り（ADR-0054。効果音の時刻を決めるために Take を Claude に見せる）。**人が頼んだときだけ**走り、
  頼むこと自体が使う意思なので、この切り替えには入れない。テキストが Claude であることだけを見る（今のまま）
- 絵のチェックの中身・やり直しの上限・履歴から選び直す口（ADR-0055 §1・§3〜）

## 今回の外

- Take のチェックを切っている間の Stage 2 は、今までのテキストが Claude でないときと同じくお試しのレビュアが判定する
  （入力から決まる結果で、`fail` もありうる）。自動の作り直し（ADR-0057）を選んだ Take では、それで作り直しが積まれうる。
  切っている間は Stage 2 を「判定していない」として残すかは、別に決める
