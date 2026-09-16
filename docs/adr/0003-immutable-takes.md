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
