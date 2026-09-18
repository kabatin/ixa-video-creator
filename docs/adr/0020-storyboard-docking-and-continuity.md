# ADR-0020: ストーリーボードは Dockview に載せ、連続性は Shot が明示する

Status: Accepted
Date: 2026-09-18
Decider: Codex（ユーザーから Phase 6.2 の設計判断を委譲）

## Context

Phase 6.2 は、ストーリーボードを制作の中心にし、ポスター、カット編集、設定を
同じ画面で往復なく扱う。パネルの移動・リサイズ・折りたたみを自作すると、
ドラッグ判定、アクセシビリティ、レイアウト復元だけで独立したUI基盤になる。

ADR-0019 は連続性参照を明示指定した Shot だけに限定したが、指定を保存する場所が無かった。
現在の `previousShotLastFrame` は指定を確認せず前 Shot の画像を返すため、決定とも一致していない。

## Decision

### ドッキング基盤

`dockview-react` を使う。

- React 19をサポートし、タブ、分割、ドラッグ、フローティング、JSON直列化を提供する
- レイアウトは `localStorage` に Project ごとに保存する。制作データではないためDBへ持ち込まない
- 保存値が壊れていた場合は既定レイアウトへ戻し、制作データの読み込みは止めない
- 狭い画面ではドッキングを使わず縦一列にする

### 連続性

Shot に `continuityMode` を追加する。

```ts
type ShotContinuityMode = 'independent' | 'previous_shot'
```

- 既定は `independent`
- `previous_shot` は利用者が明示した場合だけ保存する
- `previousShotLastFrame` は `previous_shot` の Shot にだけ画像を返す
- 現段階で選べる境界処理は ADR-0019 の「そのまま許容」だけ。UIで1フレーム重複の可能性を明示する
- 1フレーム削除・少し手前のフレーム利用は、生成・編集尺への影響を一体で実装できる段階まで選択肢に出さない

## Consequences

- 通常の別カットが前の絵に引きずられない
- 連続する Shot がストーリーボード上で鎖として見える
- パネル基盤を保守する必要がない
  − UI依存が1つ増える
  − `previous_shot` の境界では同一フレームが約1フレーム分続く可能性がある
