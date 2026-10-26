---
name: ixa-setup
description: ixa（iXA Video Creator）を入れる・更新する・調子を見る。「ixa を入れて」「使えるところまで整えて」「ixa を更新して」「ixa の調子を見て」「doctor を回して」のときに使う。pnpm ixa setup / update / doctor / mcp を INSTALL.md の手順どおりに回し、人の同意が要る所（Homebrew・Docker Desktop・課金の鍵・アクセス用の鍵の発行・DB の共有・MCP の書き込み）で止まって聞く。
---

# ixa-setup

リポジトリ直下の `INSTALL.md` が手順の正。**最初に読んでから**、その順に進める。ここには要点だけ書く。

## 頼まれごとと最初の 1 手

| 頼まれごと | 最初に打つ |
|---|---|
| 入れて・整えて | `pnpm install` → `pnpm -s ixa setup --yes --json` |
| 調子を見て | `pnpm -s ixa doctor --json` |
| 更新して | `pnpm -s ixa update --check --json` → 人に版を伝えて `pnpm -s ixa update --json` |
| Claude Code / Codex から使いたい | `pnpm -s ixa mcp --claude`（または `--codex`） |

## 進め方

1. 答えの JSON の `steps`（setup・update）と `results`（doctor）を見る。
2. 止まった手順（`needs_human` / `failed`）と ✗（`level: fail`）を上から 1 つずつ:
   - `fix.needsHuman: true` → **人に聞いて待つ**（`message`・`fix.hint`・`fix.command` を見せる）。
   - そうでなければ `fix.command` を打ち、同じコマンドをもう一度回す。
3. `ok: true` になったら、残っている !（`warn`）のうち人が決めるものと、次の 1 手（`next`）を報告する。

## してはいけないこと

- 鍵の値を表示する・ファイルに書く。アクセス用の鍵を DB に作る（発行は画面 http://localhost:3000/access-keys で制作者が押す）。
- `docker compose down -v`、値の入った `.env` の行の書き換え、`--force`・`--write` を人の許可なしに付けること。
- `pnpm dev` を勝手に止める・起動し直す（作っている途中の絵や動画が止まる）。
