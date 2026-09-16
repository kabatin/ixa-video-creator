# AGENTS.md — 実装エージェント運用規約

このリポジトリは AI エージェントによる並列実装を前提に設計されている。
**アーキテクチャを推測しないこと。** 必要な情報はすべてドキュメントに書かれている。

| 読む順番 | ファイル | 内容 |
|---|---|---|
| 1 | `docs/ARCHITECTURE.md` | 全体設計・技術選定・フェーズ |
| 2 | `docs/DOMAIN.md` | ドメインモデル（唯一の正） |
| 3 | `docs/adr/` | なぜその技術を選んだか |
| 4 | `CLAUDE.md` | コーディング規約 |
| 5 | `tasks/todo.md` | 現在のタスクと担当 |

---

## 1. 責任構造

```
Architect (Claude Opus 5, メインセッション)
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

**検証していないものを「完了」と報告しないこと。** テストが落ちているなら落ちていると書く。

---

## 5. 実装前チェックリスト

- [ ] `docs/DOMAIN.md` に該当エンティティの定義があるか確認した
- [ ] 既存の類似実装を `grep` で探した（重複実装の禁止）
- [ ] 自分の File Ownership 範囲を確認した
- [ ] Acceptance Criteria を読み、検証方法を決めた

## 6. 実装後チェックリスト

- [ ] `pnpm typecheck` が通る
- [ ] `pnpm lint` が通る
- [ ] 新規ロジックにユニットテストがある
- [ ] `console.log` を残していない（logger を使う）
- [ ] ハードコードされた値・シークレットがない
- [ ] ミューテーションをしていない（新しいオブジェクトを返す）
- [ ] エラーを握り潰していない
- [ ] Ownership 外のファイルを触っていない

---

## 7. よくある違反

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
