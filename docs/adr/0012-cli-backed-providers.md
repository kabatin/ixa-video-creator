# ADR-0012: CLI を Provider 実装の一形態として扱う

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

ユーザーの方針:
- 画像生成は **Codex CLI** を使いたい
- LLM は **Claude Code CLI** を使いたい
- 動画生成のみ外部 API を契約する

個人開発であり、既存のサブスクリプションを活かして API 課金を避けたいという意図。合理的である。

### 事実確認（2026-09 時点）

**Codex CLI の画像生成**
- 組み込みの `image_gen` ツールがあり、**`OPENAI_API_KEY` を必要としない**（サブスク認証で動く）。
- 参照画像を受け付け、編集モード（inpainting / 背景差し替え / 合成 / 透過）もある。
- 出力は `$CODEX_HOME/generated_images/...` に保存される。
- 別経路として `scripts/image_gen.py` があり、`generate` / `edit` / `generate-batch` の
  サブコマンドを持つ。こちらは**引数と出力先が決定的**だが `OPENAI_API_KEY` が必要。
- 出典: https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md

**Claude Code CLI のヘッドレス実行**
- `claude -p "..." --output-format json` で非対話実行でき、
  `result` / `total_cost_usd` / `duration_ms` / `session_id` を含む JSON を返す。
- `--allowedTools` / `--permission-mode` で無人実行時のプロンプトを抑止できる。
- 画像ファイルを入力として渡せるかは**要検証**（Read ツールは画像を扱えるため動く見込みだが未確認）。

## Decision

**CLI を「もう 1 つの Provider 実装」として扱う。特別扱いしない。**

`ImageProvider` / `LLMProvider` の interface はそのまま使い、
HTTP アダプタと並んで CLI アダプタを置く。

```
packages/providers/image/
  ├─ fal-seedream.ts        HTTP アダプタ
  ├─ gemini-image.ts        HTTP アダプタ
  └─ codex-cli.ts           サブプロセスアダプタ
packages/providers/llm/
  ├─ anthropic-api.ts       HTTP アダプタ
  └─ claude-cli.ts          サブプロセスアダプタ
```

`submit` / `poll` の形は変えない。CLI アダプタでは
`submit` = 子プロセス起動してハンドルを返す、`poll` = プロセスの終了を確認する、と実装する。
**呼び出し側は HTTP か CLI かを知らない。**

### 用途による使い分け

CLI 実行には無視できない制約がある。**量と人の関与で使い分ける。**

| 用途 | 件数 | 人の関与 | 推奨 |
|---|---|---|---|
| キャラクター四面図・Look 画像・ブランド素材の作成 | 数十枚 | あり（承認する） | **Codex CLI** |
| Shot ごとのキーフレーム画像生成 | 100 枚以上 | なし（自動ループ） | **HTTP の ImageProvider** |
| AI Review（画像判定） | Take ごと | なし | **Claude CLI**（コストが出るため計測可能） |
| 音楽セクションの命名など軽量な LLM 呼び出し | 少数 | なし | **Claude CLI** |

理由:
- **低volume・人が承認する作業は CLI が向く。** 対話的に作り直せることが利点になる。
- **高volume・自動ループは CLI が向かない。**
  - `$CODEX_HOME/generated_images/` を走査して新規ファイルを拾う実装は壊れやすい。
  - 1 生成 = 1 サブプロセスで、同時実行数がサブスクのレート制限に縛られる。
  - 組み込みツール経由では**1 回あたりのコストが取得できない**ため、
    `Take.costUsd` と `budgetUsd` によるガード（§11）が機能しない。

### 再現性の扱い（ADR-0003 との整合）

CLI はエージェントであり、同じ入力でも内部の振る舞いが一致するとは限らない。
これは「Take から入力を完全に再現できる」という ADR-0003 の前提と衝突する。

**妥協点**: Take には以下を保存する。

```ts
providerParams: {
  kind: 'cli'
  command: string        // 実際に実行したコマンド全文
  cwd: string
  cliVersion: string     // codex --version / claude --version
  exitCode: number
  stdoutDigest: string   // 全文ではなくハッシュ + 先頭 N 文字
}
```

**「同じコマンドを流せば同じ結果が出る」とは保証しない。**
保証するのは「何を実行したかが残る」ことまで。ドキュメントに明記し、
再現性が要る箇所（本番の最終生成）では HTTP アダプタを使う。

### 実装上の規約

- サブプロセス実行は `packages/providers/core/cli-runner.ts` に集約する。
  各アダプタが個別に `spawn` を書かない。
- **必ずタイムアウトを設定する**（既定 10 分）。ハングした CLI がキューを詰まらせる。
- **作業ディレクトリを生成ごとに隔離する**（一時ディレクトリ）。
  出力ファイルの取り違えを防ぐ。
- stdout / stderr は必ず捕捉してログに残す。exit code を先に見てから出力を解釈する。
- 生成された画像は**即座に MediaAsset へ取り込む**（S3 へ格納）。
  `$CODEX_HOME` に置いたままにしない。

## Consequences

+ 画像生成と LLM の API 課金がゼロになる。個人開発の予算に対して大きい。
+ Provider 抽象化が「HTTP 以外」にも耐えることが検証できる。設計の健全性が上がる。
+ キャラクター素材づくりを対話的に詰められる。品質面でむしろ有利。
− 高volume の自動ループでは使えない。HTTP アダプタとの併用が前提になる。
− 再現性が HTTP アダプタより弱い。上記の妥協点を明記して運用する。
− CLI のバージョンアップで挙動が変わりうる。`cliVersion` を記録して追跡する。

## Follow-up

- [ ] `claude -p` に画像ファイルを渡して判定させられるかを Phase 1 で検証する。
      できない場合、AI Review は Anthropic API の HTTP アダプタに切り替える。
- [ ] `codex exec` で `image_gen` を非対話に駆動し、出力パスを確実に取得できるかを検証する。
      できない場合、`scripts/image_gen.py`（要 `OPENAI_API_KEY`）へ切り替える。
