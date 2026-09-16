# ADR-0010: Remotion をタイムラインレンダラにする（Renderer Port 付き）

Status: **Accepted（確定）**
Date: 2026-09-16 / 2026-09-16 に Q1 解決
Decider: Architect

## Context

spec.md §23 は FFmpeg / Remotion / ブラウザレンダリングの比較を求めている。
本システムには 2 つの厳しい要求がある。

1. **プレビューとレンダリングが一致すること。** 「プレビューでは合っていたのに書き出すとズレる」
   は映像制作ツールとして致命的である。
2. **モーショングラフィックス（テキスト・書道・墨・ロゴ演出）を作れること。**

FFmpeg のフィルタグラフを自前構築する方式は、この 2 つを同時に満たすのが非常に難しい。
ブラウザプレビューのために別実装を持つことになり、必ず乖離する。

### ライセンス調査結果（2026-09-15 時点の一次情報）

Remotion は source-available であり OSI 的な OSS ではない。

| 条件 | 可否 |
|---|---|
| 個人・個人事業主 | 無償（商用可） |
| **営利法人で従業員 3 名以下** | 無償 |
| **営利法人で従業員 4 名以上** | **Company License 必須** |
| 非営利団体 | 無償（書類提出を求められる場合あり） |
| 政府・公共・教育機関 | 無償対象**外**（書面許可が必要） |

- 複数の会社・フリーランス・委託先が同一 Remotion プロジェクトを操作する場合、**人数は合算**される。
  完成 MP4 のみを受け取るクライアントは人数に含まれない。
- 価格: **Remotion for Creators $25/月/シート**（最低シート数なし）、
  **Remotion for Automators $0.01/レンダリング（最低 $100/月）**、Enterprise は $500/月〜。
- 出典: https://www.remotion.dev/docs/terms , https://www.remotion.dev/docs/license/faq ,
  https://github.com/remotion-dev/remotion/blob/main/LICENSE.md , https://www.remotion.pro/license

**本プロジェクトは法人での利用であり、従業員 4 名以上であれば Company License が必要になる。**

## Decision

**Remotion をタイムラインレンダラとして採用する。ただしレンダラを Port の背後に置く。**

```ts
// packages/domain/render/port.ts — Domain 側の抽象
interface TimelineRenderer {
  readonly id: 'remotion' | 'ffmpeg'
  readonly capabilities: {
    motionGraphics: boolean
    textAnimation: boolean
    perClipEffects: boolean
  }
  render(doc: TimelineDocument, preset: RenderPreset, onProgress: (p: number) => void): Promise<RenderResult>
}
```

- 既定実装は `RemotionRenderer`。`TimelineDocument` をそのまま composition props に渡す。
- **ブラウザプレビューは `@remotion/player` で同じコンポジションを描画する。**
  これが採用の最大の理由。プレビューとレンダリングのコードパスが 1 本になる。
- 退避実装として `FfmpegRenderer` を用意する余地を残す。
  モーショングラフィックスを伴わない Shot の単純連結・トランジション・音声ミックスは
  FFmpeg だけで実現できる。capability フラグで機能差を明示する。
- 実行形態は **自前サーバ/コンテナ上の `renderMedia()`**（Node.js API）とする。
  Remotion Lambda は AWS 実費に加えてライセンス料が別途かかり、
  MVP の規模（1 本の MV）では分散レンダリングの必要がない。
- FFmpeg は Remotion v4 以降に軽量版が同梱されるが、
  **素材の正規化（前処理）と最終エンコード・音声ミックス（後処理）は自前の FFmpeg で行う**。
  Remotion には合成だけを担当させる。

## Alternatives considered

- **FFmpeg のみ** — ライセンスは完全にクリーン（LGPL/GPL）でコストゼロ。
  しかしモーショングラフィックスを作れず、プレビュー用に別実装が必要になる。
  spec.md §14/§23 がモーショングラフィックスを明確に要求しているため却下。
  ただし **Q1 で Company License が取得できない場合の第一退避先**とする。
- **ブラウザ内レンダリング（WebCodecs）** — サーバ不要だが、長尺・高解像度で不安定。
  ユーザーのマシンを占有する。却下。
- **Remotion Lambda** — 分散レンダリングは強力だが、AWS 構成の複雑さと
  レンダリング課金が MVP に見合わない。将来の選択肢として残す。

## Consequences

+ プレビューとレンダリングが構造的に一致する（音ズレ・尺ズレのクラスの事故が消える）。
+ モーショングラフィックスを React で書ける。書道・墨・ロゴ演出の実装難度が大きく下がる。
+ タイムラインのデータ構造をそのままレンダラに渡せる。変換層が不要。
− **ライセンス費用が発生する**（従業員 4 名以上の場合、$25/月/シート〜）。
− Remotion への依存が深くなる。
  → `TimelineRenderer` Port で隔離し、`packages/render` 以外から Remotion API を呼ばせない。

## Q1 の解決（2026-09-16）

ユーザー確認の結果、**個人開発であり、Remotion を操作するのは本人のみ**。
Remotion Free License の原文は対象者の筆頭に "an individual" を挙げており、
**個人は人数条件なく無償対象**（成果物の商用利用可否とは独立）。
したがって **ライセンス費用は発生しない。この ADR を確定とする。**

ただし将来 **Remotion を操作する人が増えた場合、人数は合算される**。
本人以外が `pnpm render` を実行する、委託先が同じプロジェクトを触る、
CI を他メンバーが運用する、といった状況になった時点で 4 名の閾値を再評価すること。
（完成 MP4 を受け取るだけの人は人数に含まれない。）

→ Phase 1 のレンダリングは**最初から Remotion で実装してよい**。
FFmpeg 単純連結による仮実装は不要になった。
`TimelineRenderer` Port は維持する（テスト用のスタブ実装に使うため）。
