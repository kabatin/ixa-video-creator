# ADR-0058: 画面の「AI エージェント」タブで、Claude CLI を流しで起こして作品を直す

Status: Accepted
Date: 2026-10-23
Decider: Claude（Architect）

## 背景

制作者の要望（2026-10-23）: ixa の MCP でできる操作を、画面の中からチャットの自然な言葉で頼みたい。
決めてもらったこと: 最初はボタン 2 つ（新しいタスク／作業を継続）、やりとりは見やすく、会話は作品ごとに残す、
モデルは選べて既定は Sonnet、確認は出すが指示があればそれに従う。

これまで、Claude CLI は終わってからまとめて受け取る口（`CliRunner`・`execFile`）でしか使っておらず、
stream-json・`--mcp-config`・`--resume`・`--permission-prompt-tool` の前例は無かった。

## 決めたこと

### 1. API が会話ごとに Claude CLI を流しで起こす

`packages/providers/llm` の `spawnCliStreamRunner`（spawn で起こし、標準出力を 1 行ずつ受ける）で起こす。
1 行は domain の `parseStreamJsonLine` が会話の行に変える。**知らない行は捨てずに `system` として残す。**

引数（CLI 2.1.289 で実際に流して確かめた。出力は `packages/domain/src/__tests__/fixtures/claude-stream-json.ts`）:

```
claude -p --output-format stream-json --verbose --model <ID>
  --mcp-config <会話の作業場所の設定ファイル> --strict-mcp-config
  --tools "" --setting-sources "" --permission-mode manual --disable-slash-commands
  --permission-prompt-tool mcp__ixa__approve [--resume <CLI の会話 ID>]
```

- **`--allowedTools` は付けない。** 付けたツールは `--permission-prompt-tool` を通らずに走った（削除も確認なしで実行された）。
- **`--setting-sources ""` と `--permission-mode manual`。** 付けないと制作者の `~/.claude` の auto モードが削除を許し、フックも走った。
- `--tools ""` で組み込みのツール（Bash・ファイルの読み書き）を外す。使えるのは ixa の MCP だけ。
- 依頼の文は stdin で渡す（引数だと `ps` に出るうえ、「--help」のような文が引数に化ける）。
- 子の env は動くのに要るもの（PATH・HOME・USER・LANG など）だけ。API の DB や外部の鍵は渡さない。
- 作業場所は会話ごとに固定する（`~/.ixa/agent-sessions/<会話>/`）。`--resume` は同じ場所でないと続きを見つけられない。
- `subtype: success` でも `is_error: true` の終わりがある（モデル名の誤り）。両方を見る。
- 毎回の依頼の頭に文脈（作品名・選んでいる Shot・再生位置・「ixa の画面の言葉で、短く日本語で答える」）を付ける。
- 終わりの行（`result`）の費用と時間を記録する。返事の 1 行目を一覧のカードの要約にする。

### 2. 鍵はやりとりごとに発行して取り消す

1 回のやりとりごとに、内部で期限 2 時間の自動化用の鍵を発行する（label「AI エージェント（会話 …）」）。
鍵そのものは MCP の設定ファイル（権限 600）の env にだけ書き、やりとりが終わったら鍵を取り消してファイルを消す。
ログ・会話の行・応答には出さない。API の起動時に、取り消し忘れのエージェントの鍵を取り消す。

### 3. 確認は MCP の `approve` と画面のカード

MCP の各ツールに危険度の印（`read` / `write` / `destructive` / `costly` / `settings`）を付けた（`ToolDef.risk`。省くと型エラー）。
MCP の annotations（readOnlyHint・destructiveHint）にも写す。

- CLI はツールを使う前に必ず `approve`（`--permission-prompt-tool`）を呼ぶ。`approve` は API に印を知らせる
  （`POST /agent-sessions/{id}/approvals`）。
- 確認が要るかは API が domain の `approvalNeeded` で決める。読むだけとふつうの書き込みはすぐ許す。
  それ以外は、確認なしの旗が立っていなければ会話に確認の行を足し、確認待ちにして、画面の答えを待つ。
- 確認の口は**そのやりとりの鍵でだけ**受ける。答えは**画面（クッキー）からだけ**受ける
  （エージェント自身が自分の確認に答えられないように）。
- 「以後このタスクでは確認しない」か、エージェントの `waive_confirmations`（制作者が「確認なしでいい」と言ったとき）で
  そのタスクの旗を立てる。立てたことは会話に残り、画面の帯に出る。制作者はいつでも戻せる。
- `approve` が API に届かないときは、読むだけなら許し、それ以外は断る（黙って許さない）。
- 印の無いツール・ixa 以外のツールは `destructive` として扱う（確認を出す側に倒す）。
- `approve` と `waive_confirmations` は、API が `IXA_AGENT_SESSION_ID` を渡したときだけ登録する。

### 4. 会話は作品ごとに DB に残す

`agent_sessions`（会話）と `agent_messages`（会話の行。`(session_id, seq)` が主キー、中身は jsonb）。
画面への配りは会話専用の SSE（`GET /agent-sessions/{id}/stream`）で、通し番号の続きから配る。
繋ぎ直すときは `Last-Event-ID` か `?after=` で取りこぼしを埋める。作品の SSE は全員に届き再送しない作りなので使わない。

### 5. 同じ作品で動くのは 1 つの会話だけ

編集のぶつかりを避ける。2 つ目は「別のタスクが作業中です」と断る。API の確認に加えて、部分一意索引
（`agent_sessions_project_busy_uidx`）で DB でも守る。API の起動時に作業中のまま残った会話は中断にし、
`--resume` で続きから話せる。テキストの AI が Claude（`claude_cli`）でなければ会話を始めずに理由を返す。

### 6. モデル

既定は `AGENT_MODEL_DEFAULT`（`claude-sonnet-5-5`）。会話ごとに画面で選び直せる。**モデル ID だけを受ける**
（別名は設定によって別のモデルに向く。`IMAGE_CHECK_MODEL` と同じ教訓）。

## 分かっている不足

- 取り消しの履歴には、エージェントの操作か制作者の操作かが出ない（`shot_edit_batches` に「誰が」の列が無い）。会話の側に操作の記録は残る。
- テキストの AI が Codex・Grok のときは使えない（確認の仕組みが Claude CLI のもの）。
- 作業中の割り込み（途中で指示を足す）は、止めてから話し直す形になる。
- 画像の添付は今回の外。
- 確認のカードに、生成の時間や費用の見積りは出さない（危険度の説明だけ）。
- エージェントの鍵は、画面の「アクセス用の鍵」の一覧に取り消し済みとして残る。
- エージェントの Claude は契約の利用枠を使う。費用は会話ごとに記録する。

## 次の段（案。まだ作らない）: 確認を API の側で強制する

いまの確認は、CLI が `--permission-prompt-tool` で `approve` を必ず呼ぶことに頼っている（CLI 任せ）。
引数は試験（`claude-agent-cli.test.ts`）で固定し、確認を飛ばす引数（`--allowedTools`・`--dangerously-skip-permissions`・
bypass 系）が無いことを表明しているが、CLI の版が上がって振る舞いが変わると素通りしうる。

案: やりとりの鍵に「エージェントの鍵」の印を付け、API の破壊・費用・設定の口（ツールの印が `destructive` /
`costly` / `settings` の口）では、その鍵の要求に**直前に allow された requestId**（ヘッダ）を求める。
- requestId は 1 回だけ使える。ツール名と入力のハッシュで結び、別の操作に使い回せない。
- 確認なしの旗が立っている会話では、API が allow を記した requestId をその場で発行する。
- 口ごとに印を持たせる表は、MCP の `ToolDef.risk` から作る（写さない）。
