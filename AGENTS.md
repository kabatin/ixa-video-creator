# AGENTS.md — 実装エージェント運用規約

このリポジトリは AI エージェントによる並列実装を前提に設計されている。
**アーキテクチャを推測しないこと。** 分からないことは書かれている場所がある。

## どこを見るか

全部を先に読む必要はない。必要になった時に、必要なものだけ引く。

| 知りたいこと | 見る場所 |
|---|---|
| エンティティの定義・関係・不変条件 | `docs/DOMAIN.md`（ドメインの唯一の正） |
| なぜその技術・その形を選んだか | `docs/adr/` |
| 全体構成・フェーズ・ライセンス上の制約 | `docs/ARCHITECTURE.md` |
| コーディング規約・レイヤールール | `CLAUDE.md` |
| 今のタスクと担当 | `tasks/todo.md` |
| 過去に踏んだ失敗 | `tasks/lessons.md` |
| 画面の構成・ワークベンチの作法 | `docs/UI-WORKBENCH*.md` |

タスクに割り当てられた Acceptance Criteria と File Ownership は、指示に直接書かれている。

---

## 1. 責任構造

```
Architect (Claude Opus, メインセッション)
  = 設計 / 分解 / レビュー / 統合 / 最終判断

Implementation Agents (Opus サブエージェント / Codex)
  = 実装 / テスト / 報告
```

実装エージェントは**設計判断をしない**。
以下は実装エージェントの権限外である。

- 新しいテーブル / エンティティ / カラムの追加
- Interface シグネチャの変更
- 依存パッケージの追加
- ディレクトリ構成の変更
- 別パッケージのファイル編集（File Ownership 外）
- 指示されていない機能の追加（"ついでに実装" の禁止）

---

## 2. BLOCKED プロトコル

「この設計では成立しない」「Interface 変更が必要」「仕様が矛盾している」と判断した場合、
**実装を止めて**以下の形式で報告する。勝手に設計を変えない。

```
BLOCKED

Task: <タスク名>
Reason:
  <何がなぜ成立しないか。具体的なファイルと行を示す>

Evidence:
  <エラー / 型不整合 / ドキュメントの該当箇所>

Suggested options:
  A. <案と影響範囲>
  B. <案と影響範囲>
  C. <案と影響範囲>

Recommendation: <どれが良いと思うか。ただし決定は Architect が行う>
```

契約の**字面どおりに作ると目的が成立しない**と分かったときも、黙って字面に従わず
BLOCKED で形を変えて提案する。

---

## 3. File Ownership

各タスクには担当ディレクトリが明示される。**そのディレクトリ以外を編集しない。**

共通ファイル（`package.json` ルート、`turbo.json`、`packages/domain/*`、DB スキーマ）は
原則として Architect が所有する。変更が必要なら BLOCKED で報告する。

同じファイルを 2 つのエージェントが同時に編集することは禁止。

---

## 4. 完了報告フォーマット

```
DONE

Task: <タスク名>
Files changed:
  - path/to/file.ts (new|modified, +N/-M)

Acceptance Criteria:
  - [x] <条件1> — <どう検証したか>
  - [x] <条件2> — <どう検証したか>

Verification:
  $ pnpm typecheck   → pass
  $ pnpm test        → 12 passed
  <実際の出力を貼る>

Not done / Out of scope:
  - <あえてやらなかったこと>

Notes for Architect:
  - <レビューで見てほしい点>
```

**検証していないものを「完了」と報告しないこと。**
テストが落ちているなら落ちていると書く。飛ばした検査は飛ばしたと書く。
何も報告しないと、集約する側では「合格」に化ける。

---

## 5. 終わったことの確認

`pnpm typecheck` と `pnpm lint` を通す。新しいロジックにはユニットテストを付ける。
検証は範囲を絞って回す（ルート全体の並列実行は実機を潰す）。

規約そのもの（immutability / Take 追記 / 秒 float / zod / logger / `any` 禁止 など）は
`CLAUDE.md` の「絶対規約」が唯一の正。ここには写さない。
lint とレビューで見るのはそちらの内容である。

---

## 6. よくある違反

| 違反 | 正しい行動 |
|---|---|
| Domain 層で `fetch` を呼ぶ | Port インターフェースを受け取り、実装は app 層で注入する |
| Provider SDK の型を Domain に露出 | Domain 型へマッピングしてから返す |
| Take を UPDATE する | 新しい Take を作る |
| 時間をフレーム数で保存 | 秒（float）で保存する |
| 「テーブルが足りないので追加した」 | BLOCKED で報告する |
| 「型が合わないので `any` にした」 | BLOCKED で報告する |
| 「ついでにリファクタした」 | Ownership 外。やらない |
| 参考 OSS からコードをコピーした | **禁止。** 参考実装には GPL-3.0 / LICENSE 不在 / Commons Clause のものが含まれる（`docs/ARCHITECTURE.md` §3）。設計の発想のみ参考にし、コードは自分で書く |
