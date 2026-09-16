# ADR-0002: Shot がタイムライン位置を所有する

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

一般的な NLE は「クリップ」がタイムライン上の実体で、素材は別管理である。
本システムは Shot First を掲げており、Shot も timing を持つ（spec.md §11 の YAML）。
両方に尺を持たせると、Shot の尺とタイムラインクリップの尺が乖離する。

## Decision

**VIDEO1 トラックは Shot 列の投影とし、独立したクリップ実体を持たない。**

- Shot が `startSec` / `durationSec` を所有する。
- タイムライン UI での移動・トリムは Shot を直接更新する。
- TEXT / VFX / VIDEO2 / SFX のみ `TimelineClip` を持つ。
- クロスディゾルブ等の重なりは `Transition` が表現し、Shot の時間は重ならない。

## Alternatives considered

- **A: Timeline がクリップを持ち Shot は素材** — NLE として正統だが、Shot 一覧と
  タイムラインで尺が二重管理になり、ミュージックビデオでは常にズレる。却下。
- **B: 双方向同期** — 同期バグの温床。却下。

## Consequences

+ 尺の真実が 1 箇所。ビートスナップも Shot に対して行えばよい。
+ 「Shot 14 の尺を 0.4 秒伸ばす」がそのまま編集操作になる。
− VIDEO1 で自由な重ね合わせができない。
  → MVP の要件（spec.md §22）を満たすため許容する。必要になれば VIDEO2 を使う。
