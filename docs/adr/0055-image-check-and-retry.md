# ADR-0055: 作った画像を自動でチェックし、手元の AI ならやり直す（履歴から選び直せる）

Status: Accepted
Date: 2026-10-19
Decider: Claude（Architect）

## 背景

制作者の要望（2026-10-19）:

- 画像は、破綻・矛盾のような「どう見てもリテイク」を自動で見つけてやり直したい
- やり直した履歴を見て、前のほうが良ければ選んでセットしたい

いまの画像のジョブ（`image_generation_jobs`。ADR-0029・0035・0051）は、できた絵をそのまま当てる。
開始フレームは上書きされ、前の絵は画面から辿れない。チェックも自動のやり直しも無い
（動画の Take だけにレビューと再生成がある。ADR-0005）。

画像を見られる AI は Claude CLI だけ（`packages/providers/llm/src/claude-cli-reviewer.ts`）。Codex と Grok は文章だけ。

## 決めたこと

### 1. 対象とチェックの中身

対象は画像のジョブの 3 種類（開始フレーム・キャラクターシート・キーアート）。動画の Take は既存のレビューのまま。

見るのは 2 つ。

- **破綻**: 手足・指・顔の崩れ（`anatomy`）、溶けた物（`artifact`）、意味の無い文字（`text`）
- **矛盾**: 指示の主要素の欠落（`prompt`）、参照画像と別人（`identity`）、Look の服や色の違い（`look`）

結果（`ImageCheckResult`）は `verdict`（`pass` / `review` / `retry`）・`score`（0〜1）・`issues[]`（種類と日本語の 1 文）・
`promptDelta`（やり直すときに指示へ足す英語の直し方。無ければ null）。

**判定は甘めにする。** `retry` は「誰が見てもリテイク」（指の数・手足の崩れ・顔の崩れ・溶けた物・意味の無い文字・
明らかな別人・指示の主要素の欠落）だけ。好みの問題は `review` か `pass`。
やり直しすぎて手元の GPU を占有しないことを、取りこぼしを減らすことより優先する。

### 2. どの AI で見るか

「使う AI」のテキストが Claude（`claude_cli`）のときだけ、Claude CLI で見る。絵は手元のファイルパスで渡し、
許すツールは Read だけ・作業場所は絵を置いた一時ディレクトリ（既存のレビューと同じ。署名付き URL を外へ出さない）。
応答は zod で検査し、費用（`total_cost_usd`）を記録する。

Claude 以外なら**チェックを飛ばし**、「チェックしていない」（`outcome: skipped`）と理由を残して今までどおり当てる。
CLI が落ちた・応答が壊れたときも、理由を残して（`outcome: failed`）当てる。**空の結果を「合格」に化けさせない**。

### 3. 流れ（状態 `checking` を足す）

ジョブの状態に `checking`（チェック中）を足す: `queued → running → checking → succeeded`。

1. 絵ができたら素材に取り込み、`checking` にして **GPU を返す**。この時点では何も当てない
2. 同じ image キューに「チェック」の手順（`{ imageJobId, step: 'check' }`）を積む。
   GPU の順番を持ったまま Claude を数十秒待たない
3. チェックの手順: 判定を `image_checks` に 1 行残す → 自動でやり直すか決める
   - やり直す: 種を変えた新しいジョブ（`retry_of_job_id` = 前のジョブ・`attempt` + 1）を積み、前のジョブを `succeeded` にする
   - やり直さない: つながり全体から当てる絵を選び（`pickImageToApply`）、当てて `applied_at` を記す。ジョブを `succeeded` にする

`checking` は「動いている」に数える。チェック中・やり直し待ちの間は、同じ Shot・キャラクターで新しく頼めない（重ねない）。

### 4. 自動でやり直す条件（`shouldAutoRetry`）

`verdict === 'retry'` かつ **画像の AI が手元（`exclusiveResource: 'local-gpu'`、いまは klein）** かつ
`attempt <= maxRetries`。`attempt` は 1 から数える（最初の 1 枚が 1）。上限 `maxRetries` は既定 2
（最大で 3 枚作る）。`IMAGE_CHECK_MAX_RETRIES`（0〜5）で変えられる。

Codex のような利用枠を使う AI では自動でやり直さない。`retry` と判定された絵も当て（下の選び方）、
画面と MCP に「やり直す」の口（`POST /image-jobs/{id}/retry`）を出す。人が押したやり直しもつながりに足し、
`attempt` を 1 つ進める（手元の AI なら、番号が上限を越えるまでは続けて自動でやり直す）。

やり直しの指示は、元の指示に前の絵の `promptDelta` を足したもの。種は手元の AI に任せる（`seed: null` で毎回変わる）。

### 5. 当てる絵の選び方（`pickImageToApply`）

つながりの中で絵がある（`succeeded` か `checking`）ジョブから選ぶ。

1. `pass` のうち最新
2. 無ければ順位で選ぶ: `review` → チェックしていない（`skipped` / `failed`）→ `retry`。同じ順位なら点の高い方、同じ点なら新しい方
3. 選んだ絵が `pass` でなければ「要確認」の印（画面は選んだ絵の判定から出す。列は持たない）

「点の最も良いもの」（計画）を、判定の順位を先に見る形にした。`review` は判定が「直さなくてよい」と言った絵で、
点が少し高い `retry` より使える。チェックしていない絵は、悪いと分かった `retry` より先にする。

**やり直しの途中では前の絵を差し替えない。** 当てるのはつながりの最後に 1 回だけ。

### 6. 「当てる」の中身

| 種類 | 当てる |
|---|---|
| 開始フレーム | 手動の参照 `start_frame` を差し替える（今までと同じ `replaceManualStartFrame`） |
| キャラクターシート | 識別画像の四面図に足す（四面図の主が無ければ主）。**当てなかった試しは足さない** |
| キーアート | 何も変えない（もともと候補を並べるだけ）。`applied_at` を記すだけ |

worker が当てたときは取り消しの記録を作らない（今までと同じ）。

### 7. 失敗と中断

- やり直しのジョブが失敗したら、前までの絵から選んで当てる（チェックの手順を、失敗したジョブについて積む）
- 人が止めたら（`cancelled`）、何も当てない（止めたら絵が変わらない、の約束を守る）。できた絵は履歴から選べる
  （チェック中に止めた行は絵を持ったまま `cancelled` になる。`imageJobViolation` はこれを許す）
- チェックの手順がキューに打ち切られたら、`checking` のジョブを `succeeded` にして何も当てない（固まって頼めなくならない）。履歴から選べる

### 8. 記録（db）

- `image_checks`（追記のみ・ジョブに 1 行）: `image_job_id`（一意）・`outcome`（checked / skipped / failed）・`verdict`・`score`・
  `issues`（jsonb）・`prompt_delta`・`note`（飛ばした・落ちた理由）・`cost_usd`・`created_at`
- `image_generation_jobs` に `retry_of_job_id`・`attempt`（既定 1）・`applied_at`

### 9. 選び直し・履歴（api / web / MCP）

- `GET /shots/{id}/start-frame/history`: その Shot の開始フレームのジョブ（絵・チェック・当てたか・いま付いているか）。新しい順
- 選び直しは既存の `PUT /shots/{id}/start-frame`（取り消しの記録がある。⌘Z で戻る）
- `POST /image-jobs/{id}/retry`: 人が押すやり直し。そのジョブと同じ AI で、つながりに足す
- キャラクターシートの状態・キーアートの一覧にチェックの結果を付ける
- 画面: 開始フレームの欄に履歴の帯（サムネイル・印・理由・拡大・「これを使う」）。識別画像とキーアートの候補に印。
  作っている間は「チェック中」「やり直し 1/2」
- MCP: 待つ（`wait {kind:"start_frame"}`）の結果とキーアートの候補にチェックを返す。チェック中は待つ。
  `list_start_frame_history`・`use_start_frame`・`retry_image` を足す
- 識別画像の印は `GET /characters/{id}/identity-images/checks`（キャラクターシートとして作った画像だけ）

## 今回の外

- 動画の Take のチェック（既存のレビューと再生成のまま）
- Claude 以外の AI での判定（Codex・Grok は画像を見られない）
- 判定の厳しさを画面で変える口（まずは甘めの 1 段で運用して様子を見る）

## 追記（2026-10-19）: 文字と頭身ではやり直さない

klein での実機確認で、ネオン看板の崩れた文字と、デフォルメの頭身の違いで「やり直す」が続いた
（TT-06 は 3 枚とも retry で、GPU を 3 回分使った）。決めたこと:

- **意味の無い文字（text）だけなら review。** klein では描き直しても直らず、GPU を使うだけ
- **頭身の違いは新しい種類 `proportion` で挙げさせ、それだけなら review。** デフォルメは作品の画風として意図したもの。
  顔・服・色が別人に見えるとき（identity・look）は、今までどおり retry
- **規則は指示の文章だけに頼らない。** domain の `enforceImageCheckVerdict` が、やり直す理由になる種類
  （`RETRY_ISSUE_KINDS` = anatomy・artifact・identity・prompt・look）が 1 つも無い retry を review に下げる。
  worker はチェックの結果を残す前にこれを通す
- 文字のことは、指示で禁じられていても text で挙げさせる（prompt に入れると retry に残るため）
- チェックのモデルは Sonnet にする（制作者の了承 2026-10-19）。Opus 相当の既定のモデルで 1 回 0.19〜0.84 ドルかかっていた。
  `IMAGE_CHECK_MODEL`（既定 `claude-sonnet-5-5`、config の zod で検査）を Claude CLI の `--model` に渡す。**チェックにだけ効かせる**。
  既定を別名 `sonnet` にしなかったのは、Claude Code の設定（`ANTHROPIC_DEFAULT_SONNET_MODEL`）でこの Mac では
  別名が Opus に向いていたため（`--model sonnet` で `modelUsage` が claude-opus-5、1 回 0.26 ドル。モデル ID なら 0.10 ドル）
  （動きの分析・レビュー・絵コンテの案などの呼び出しは変えない）


## 追記（2026-10-28）: 既定は切る（ADR-0066）

§2 の「テキストが Claude なら必ず見る」は ADR-0066 で置き換えた。「使う AI」の「描いた絵をチェックする」を入れていて、
テキストが Claude のときだけ見る。既定は切る（切っている間は `outcome: skipped` と理由を残して当て、描き直さない）。
