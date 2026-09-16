# ADR-0009: 音楽解析は librosa を既定とし、解析器をプラガブルにする

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

spec.md §21 は BPM / Beat / Downbeat / Section / Energy / Break / Drop の解析を要求する。
候補ライブラリを調査した結果、**機能が優れたものほどライセンスが商用に向かない**ことが判明した。

| ライブラリ | 機能 | ライセンス | メンテ |
|---|---|---|---|
| librosa | BPM / beat / onset（downbeat・section は自前実装） | **ISC（商用可）** | 非常に活発（2026-09 時点で更新中） |
| madmom | beat / **downbeat** / onset（MIREX 上位実績） | コードは BSD-2 だが**学習済みモデルが CC BY-NC-SA 4.0（非商用）** | PyPI は 2018 年で停止 |
| essentia | BPM / beat / key / chord | **AGPL-3.0**（商用は別途契約） | 活発だが長年ベータ |
| allin1 | BPM / beat / **downbeat / section ラベル** を一括 | MIT だが**依存に madmom を含む**（非商用モデルを継承） | 2023-10 以降更新なし |
| web-audio-beat-detector | BPM のみ | MIT | 活発 |

iXA CUP MV は社内の本番制作物であり、非商用ライセンスのモデルに依存させるのは不適切と判断した。

## Decision

- **既定の解析器は librosa（ISC）** とする。`analyzer = 'librosa-v1'`。
  - BPM / beats / onsets: `librosa.beat.beat_track` と `librosa.onset`。
  - **downbeats**: 拍子（既定 4/4）と beat グリッド、およびオンセット強度のピークから推定する自前実装。
  - **sections**: librosa の Laplacian segmentation（再帰行列 + スペクトラルクラスタリング）で境界を検出し、
    ラベル付け（intro/verse/chorus …）は **エネルギー特徴を LLM に渡して命名**する。
  - **drops**: エネルギー曲線の急峻な立ち上がりを閾値検出する決定的処理。
- **`MusicAnalyzer` をプラガブルにする。** `MusicAnalysis.analyzerVersion` に解析器名を保存し、
  別解析器の結果と共存・再解析できるようにする（`docs/DOMAIN.md` §7 に定義済み）。
- **解析結果は人間が補正できる。** BPM とダウンビート位置は UI から手動上書き可能にし、
  上書き値を `analyzerVersion = 'manual'` として保存する。自動解析の精度に制作を依存させない。
- allin1 / madmom は **評価用途に限り** 別 analyzer として実装してよいが、
  既定にはせず、非商用である旨をコードのヘッダに明記する。

## Consequences

+ 商用ライセンス上クリーンなまま出荷できる。
+ 解析器を差し替えても Domain とタイムラインは変更不要。
+ 手動補正があるため、downbeat 推定の精度不足が制作のブロッカーにならない。
− downbeat / section を自前実装する工数が発生する（見積: 1〜2 日）。
− ジャンルによっては自動 section 検出が弱い。
  → MV は 1 曲のみであり、手動補正で十分にカバーできる。
