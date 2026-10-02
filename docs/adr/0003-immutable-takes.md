# ADR-0003: Take は Immutable、生成入力は完全スナップショット

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

spec.md §18 は「履歴は Immutable」と定める。AI 生成は非決定的でコストがかかるため、
「どの入力でこの映像が出たか」を後から完全に再現できることが制作上きわめて重要である。

## Decision

- `Take` は作成後 `reviewStatus` と `humanVerdict` 以外を更新しない。
- Take は `ShotGenerationSpec`（Provider 非依存の生成仕様）を**丸ごと JSONB で保持**する。
  参照先 Shot / Character / Look が後で変更されても Take の再現性は失われない。
- `specHash = sha256(canonicalJson(spec))` を保存し、同一入力の重複生成を検知する。
- 実際に Provider へ送った固有パラメータ（`providerParams`）と `seedUsed` も保存する。
- やり直しは `parentTakeId` + `regenerationReason` を持つ新しい Take を作る。

## Consequences

+ 任意の Take を完全に再現・比較できる。Review の根拠が残る。
+ コスト集計・Provider 品質比較が Take テーブルだけで完結する。
− Take 行が肥大化する（spec の JSONB）。
  → 1 Take あたり数 KB。数千 Take でも問題にならない。許容する。

## 追記（2026-10-02）: Take を消す＝見えなくする

制作者 2026-10-01「Take を消す口」。作り直しても消さない約束は守ったまま、**要らない Take を一覧から外せる**ようにする。

- 行も中身も消さない。`takes.deleted_at` に見えなくした時刻を入れるだけ（作成後に変えてよいのは `reviewStatus`・`humanVerdict` とこの印）
- 見えなくした Take は、一覧・比較・採用・Shot の状態の判断から外れる（`TakeRepository.findById` / `findByShot` の既定）
- **残るもの**: 記録（系譜を辿る・取り込みのやり直し）と、**払った額**（費用の合計・予算の判断）。自動の作り直しの上限も
  見えなくした Take を数える（消すたびに上限が戻ると止まらなくなる）
- 採用中の Take は断る（タイムラインと書き出しが使っている。先に採用を外す）
- 最後の 1 本を消したら Shot は下書きに戻す（人が減らしたので、失敗の痕跡を残す「要判断」にしない）
- 戻す口は今は無い（DB の印を消せば戻る）
