# ADR-0022: 楽曲のマスター付け替え・削除と、Take の採用を外す口を足す

Status: Accepted
Date: 2026-09-19
Decider: Claude（Architect）。制作者の依頼（2026-09-19「ついでに実装して」）

## Context

UI-WORKBENCH-2 で楽曲をワークベンチの「物」として扱うことにしたが、API には
楽曲の登録と一覧しか無く、マスターの付け替え・削除・題名の修正ができなかった。
Take の採用も付けるだけで外せず、検証で付けた採用を元に戻せなかった。

## Decision

| 口 | 振る舞い |
|---|---|
| `PATCH /music-tracks/{id}` | 題名・オフセット・音量だけを直す（`UpdateMusicTrackPatch`、strict）。マスターは受けない |
| `POST /music-tracks/{id}/set-master` | その曲をマスターにし、同じ Project の他を降格する。応答は Project の全曲 |
| `DELETE /music-tracks/{id}` | ソフトデリート。マスターを消したら残りで最初に登録した曲をマスターへ（`nextMasterAfterRemoval`） |
| `DELETE /shots/{id}/selected-take` | 採用を外す。Take は消さない（規約 2）。状態は `review`。生成中なら状態は触らない |

- マスターの規則（Project に常にちょうど 1 曲）は create と同じ。降格と昇格は 1 トランザクション
- 規則の判断は domain の純粋関数、DB への反映は repository。API はそれを呼ぶだけ

## Consequences

- DB スキーマは変えない（`deleted_at` と `is_master` は既存）
- 採用を外した出来事は、採用と同じく Shot の状態の出来事として SSE で流れる
