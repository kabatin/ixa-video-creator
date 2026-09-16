# ADR-0004: Capability 記述による Provider 抽象化

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

spec.md §16/§17 は Provider Neutral と Model Router（`provider = AUTO`）を要求する。
動画生成 API はモデルごとに、対応秒数・アスペクト比・参照画像枚数・seed 対応・
カメラ制御の有無が大きく異なる。共通 interface だけでは「このモデルで生成可能か」を判断できない。

## Decision

Provider 抽象化を **実行 interface + 宣言的 capability 記述** の 2 層にする。

```ts
interface VideoProvider {
  readonly id: ProviderId
  readonly models: readonly VideoModelDescriptor[]
  submit(req: VideoGenerationRequest): Promise<ProviderJobHandle>
  poll(handle: ProviderJobHandle): Promise<ProviderJobStatus>
  cancel(handle: ProviderJobHandle): Promise<void>
}

type VideoModelDescriptor = {
  id: ModelId
  capabilities: VideoModelCapabilities  // 対応秒数・参照枚数・seed・カメラ制御・コスト等
  qualities: QualityProfile             // character_consistency / motion / physics などの評価値
}
```

- `capabilities` は**バリデーション**に使う（不可能な要求を投げる前に弾く）。
- `qualities` は**Model Router のスコアリング**に使う。
- Router は MVP では **決定的なルールベース**とし、LLM を使わない。
  理由: テスト可能・再現可能・無料・レイテンシゼロ。判断根拠を `RouterDecision` として保存する。
- Domain は Provider パッケージに依存しない。`ProviderRegistry` を app 層で注入する。

## Consequences

+ 新しい Provider の追加が「descriptor + adapter」の 2 ファイルで済む。
+ 「この Shot は参照画像 4 枚が必要 → 対応モデルはこれだけ」を静的に解決できる。
+ Router の挙動をユニットテストできる。
− capability 記述を人手で維持する必要がある。
  → 各 adapter に契約テストを置き、実 API のエラーで乖離を検知する。
