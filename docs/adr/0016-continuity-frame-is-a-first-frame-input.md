# ADR-0016: 連続性フレームは「開始画像」として渡す

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

`resolveReferences` は前 Shot の最終フレームを role `previous_shot_last_frame` で
候補に積む。しかし **どの VideoModelDescriptor もこの role を宣言していない**ため、
`supportedRoles` のフィルタで必ず落ちる。連続性参照は一度も Provider へ渡っていない。

素直に見えるのは「スタブの roles に足す」だが、その前に決めるべきことが 2 つある。

1. 実モデル（Veo / Seedance / Kling）に「前 Shot の最終フレーム」という入力は無い。
   あるのは image-to-video の **開始画像** 1 枚である
2. `start_frame`（明示したキーフレーム）と `previous_shot_last_frame` は、
   どちらも同じ開始画像の枠に落ちる。両方立ったときにアダプタが選べない

`GenerationContextSource.startFrame` は `sourceType` が `ai_image_to_video` の
ときだけ非 null を返すが、`previousShotLastFrame` は `sourceType` を見ない。
つまり **両方が立つ Shot が実在しうる**。

## Decision

**1. `previous_shot_last_frame` は開始画像の意味で扱う。**
`start_frame` を宣言しているモデルは、この role も宣言する。
role は「利用者にとっての意味」であり、アダプタが Provider の語彙へ翻訳する。

**2. 明示したキーフレームがあるときは、連続性フレームを候補に積まない。**
`resolveReferences` は `startFrameId` が非 null なら `previousShotLastFrameId` を捨てる。

## Rationale

役割を分けたまま両方を渡すと、同じ枠を 2 つの参照が奪い合う。
解決をアダプタへ先送りすると、**Provider ごとに違う答えを書くことになり**、
同じ仕様から同じ結果が出るという ADR-0003 の前提が崩れる。
落とすなら `resolveReferences` の中、つまり `specHash` に含まれる場所で落とす。

捨てるのは連続性フレームのほうである。`start_frame` は利用者が
「この画から始める」と明示した指定で、連続性は前の Shot から自動で導いた推測にすぎない。
`REFERENCE_PRIORITY` も既に `start_frame`(3) < `previous_shot_last_frame`(5) の順で、
この判断と整合している。

優先度による切り詰めに任せず候補の段階で捨てるのは、
**枠が余っているときに両方入ってしまう**ため。上限 9 枚のモデルでは
優先度だけでは落ちず、開始画像が 2 枚ある仕様ができあがる。

## Consequences

- `ai_image_to_video` の Shot では連続性フレームが渡らない。
  キーフレームを指定した時点で利用者が始点を決めているので、これは意図どおり
- スタブ 2 種が `previous_shot_last_frame` を宣言する。実アダプタを書くときは、
  この role を Provider の開始画像パラメータへ写すこと
- 「前 Shot の最終フレームと明示キーフレームを両方渡したい」要求が出たら、
  この ADR を置き換える。その時点で end_frame との組み合わせも設計し直すことになる
