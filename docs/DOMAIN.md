# Domain Model — Shot First Architecture

Status: v1 (Architect 決定済み / 実装前)
Owner: Architect (Claude Opus 5)

このドキュメントは実装エージェントにとっての**唯一の正**です。
ここに書かれていない概念を実装側で発明しないこと。矛盾を見つけたら BLOCKED で報告すること。

---

## 0. 設計原則

1. **Shot が中心**。Storyboard / Generation / Take / Review / Timeline はすべて Shot に接続する。
2. **Identity と Look を分離**。人物の同一性と、時系列による外見を別エンティティにする。
3. **Take は Immutable**。生成結果は上書きしない。やり直しは新しい Take。
4. **生成入力は完全にスナップショットする**。Take から同じ入力を再現できること。
5. **Domain は IO を持たない**。`packages/domain` は純粋な型・スキーマ・ロジックのみ。
6. **Provider 語彙を Domain に漏らさない**。`seedance_duration_5s` のような値は Domain に存在しない。
7. **ID は型で区別する**。`ShotId` と `TakeId` は相互代入不可能（branded type）。

---

## 1. エンティティ全体図

```
Workspace
 ├─ Character ──┬─ CharacterIdentityImage
 │              └─ CharacterLook ── CharacterLookImage
 ├─ BrandAsset
 ├─ Location
 ├─ MotionTemplate
 └─ Project
     ├─ MusicTrack ── MusicAnalysis
     ├─ Script ── ScriptVersion
     ├─ Sequence
     │   └─ Shot ──┬─ ShotCharacter (character + look)
     │             ├─ ShotReference
     │             ├─ GenerationJob
     │             ├─ Take ──┬─ ReviewRun ── ReviewFinding
     │             │         └─ MediaAsset
     │             └─ Transition (次 Shot との間)
     ├─ TimelineClip (TEXT / VFX / SFX / OVERLAY トラック)
     └─ RenderJob ── MediaAsset (最終 MP4)

MediaAsset は全エンティティから参照される共通の実体（すべてのファイル）。
```

---

## 2. 共通値オブジェクト

```ts
type Seconds = number            // 常に秒（ミリ秒・フレームを混在させない）
type Frame = number              // fps 文脈が明確な箇所のみ
type Ulid = string               // すべての ID は ULID（時系列ソート可能）

// branded id
type ShotId = Ulid & { readonly __brand: 'ShotId' }
type TakeId = Ulid & { readonly __brand: 'TakeId' }
// ... 各エンティティに同様に定義する

type TimeRange = { start: Seconds; end: Seconds }   // end は排他
type Resolution = { width: number; height: number }
type Cost = { amountUsd: number; unit: string; estimated: boolean }
```

**時間の扱いのルール**
- Domain / DB は常に **秒（float）** で保持する。
- フレーム変換は `packages/timeline` の関数でのみ行う。
- Project が `fps` を持ち、レンダリング直前にフレームへ丸める（`round`, 非 `floor`）。

---

## 3. Workspace / Project

```ts
/** すべてのエンティティのルート。MVP では 1 つだけ存在する想定。 */
type Workspace = {
  id: WorkspaceId
  name: string
  createdAt: Date
  updatedAt: Date
}
```

### ID は呼び出し側が採番してよい

以下の 2 つの場合、**呼び出し側が先に ULID を採番する**。リポジトリに任せない。

1. **2 段階のフロー** — 例: アップロードは署名時に ID が決まり、`storageKey` にその ULID が埋まる。
   後から別の ID を振るとパスと行がずれる。
2. **相互参照** — 例: `Take.mediaAssetId` と `MediaAsset.origin.takeId` が互いを要求し、
   そのままでは作成順序が決まらない。先に ID を採番して循環を断つ。

`CreateXxxInput` の `id` は任意フィールドとし、省略時のみリポジトリが採番する。

**リポジトリの入力型は Domain が定義する。** `CreateXxxInput` / `UpdateXxxPatch` を
`packages/db` 側で定義しないこと。契約は Domain が持ち、db はそれを実装する（ADR-0007）。
例: `CreateMediaAssetInput` は派生物（probe / proxy / thumbnail / posters）を省略できる。
これらは media キューが後から埋めるため。


```ts
type Project = {
  id: ProjectId
  workspaceId: WorkspaceId
  name: string
  // 出力仕様（レンダリングとプロバイダ選択の制約になる）
  fps: 24 | 25 | 30 | 60
  resolution: Resolution
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:5' | '21:9'
  // 制作制約
  durationSec: Seconds | null      // 楽曲確定後に確定
  budgetUsd: number | null         // 生成コスト上限（超過で自動生成停止）
  styleGuide: string               // 全 Shot の prompt に注入される共通スタイル記述
  status: 'planning' | 'production' | 'review' | 'finalizing' | 'done'
  createdAt: Date
  updatedAt: Date
}
```

---

## 4. MediaAsset（すべてのファイルの唯一の実体）

ファイルを持つものは必ず MediaAsset を経由する。Character 画像も、生成動画も、最終 MP4 も同じ。

```ts
type MediaAsset = {
  id: MediaAssetId
  workspaceId: WorkspaceId
  projectId: ProjectId | null       // null = ライブラリ共有資産
  kind: 'image' | 'video' | 'audio' | 'font' | 'lut' | 'other'
  // ストレージ
  storageKey: string                // S3 互換のキー。URL は保存しない（署名URLは都度生成）
  mimeType: string
  bytes: number
  checksumSha256: string            // 重複排除と再現性検証に使う
  // 派生物（ffprobe / ffmpeg で生成）
  probe: MediaProbe | null
  proxyKey: string | null           // 編集プレビュー用の軽量版
  thumbnailKey: string | null
  posterKeys: string[]              // Review 用の抽出フレーム
  // 出自
  origin: MediaOrigin
  createdAt: Date
}

type MediaProbe = {
  durationSec: Seconds | null       // コンテナの尺（音声が長ければ音声の尺）
  videoDurationSec?: Seconds | null // 映像ストリームだけの尺。フレームを切り出す位置の基準
  width: number | null
  height: number | null
  fps: number | null
  hasAudio: boolean
  codec: string | null
}

type MediaOrigin =
  | { type: 'upload'; uploadedBy: string }
  | { type: 'generated'; takeId: TakeId }
  | { type: 'rendered'; renderJobId: RenderJobId }
  | { type: 'derived'; sourceAssetId: MediaAssetId; operation: string }
```

**規約**: 署名付きURLは DB に保存しない。プロバイダが返す期限付きURLは即座にダウンロードして自前ストレージへ格納する。

---

## 5. Character / Look（§13 の分離）

```ts
type Character = {
  id: CharacterId
  workspaceId: WorkspaceId
  name: string                      // 'takepi'
  displayName: string               // '藤本タケピ'
  description: string               // 不変の身体的特徴。Look で変わらないもののみ書く

  // プロンプト断片は「1 本の文字列」ではなく役割ごとに分割する。
  // 理由: 再生成時に「identity が不一致 → anchors だけ強める」という部分調整ができる。
  identityAnchors: string[]         // 同一性のアンカー特徴 '切れ長の目', '左眉に小さな傷'
  styleTokens: string[]             // 描写のトーン '硬質な光', 'シネマティック'
  colorPalette: string[]            // 人物に紐づく配色 '#1A1A1A', '#FFD200'

  createdAt: Date
}

type CharacterIdentityImage = {
  id: CharacterIdentityImageId
  characterId: CharacterId
  mediaAssetId: MediaAssetId
  role: 'four_view' | 'face_front' | 'face_side' | 'face_three_quarter' | 'full_body' | 'profile'
  isPrimary: boolean                // Provider の参照枚数制限時に優先される
  order: number
}

// 'four_view' = 正面 / 側面 / 背面 / 斜め を 1 枚にまとめたターンアラウンドシート。
// Veo と Runway は参照画像を 3 枚しか受け付けない（ARCHITECTURE.md §9）。
// 個別画像を 3 枚渡すと衣装・ロケーション・ブランドの枠が無くなるため、
// 四面図 1 枚に集約して 1 枠で同じ情報量を渡す。ReferenceResolver が自動で選ぶ。

type CharacterLook = {
  id: CharacterLookId
  characterId: CharacterId
  key: string                       // 'IXA_CUP_PAST' — Shot からはこのキーで指定
  name: string                      // 'iXA CUP 2019 当時'
  era: string | null                // '2019'
  description: string               // 髪型・服装・年齢感。Look 固有の差分のみ
  wardrobeTokens: string[]          // 'iXA 2019 ユニフォーム', '黒髪短髪'
  styleTokens: string[]             // この Look 固有のトーン
  colorPalette: string[]            // この Look の配色
  isDefault: boolean

  // この Look の canonical reference。
  // 最初に承認された Take の 1 フレームを昇格させ、以降の全 Shot で使ってドリフトを止める。
  canonicalFrameAssetId: MediaAssetId | null
}

type CharacterLookImage = {
  id: CharacterLookImageId
  lookId: CharacterLookId
  mediaAssetId: MediaAssetId
  role: 'wardrobe' | 'hair' | 'full_body' | 'reference_still'
  isPrimary: boolean
  order: number
}
```

**不変条件**
- Character は最低 1 つの `isDefault` な Look を持つ。
- Shot が Character を参照するとき、Look の指定は必須（省略時は default を解決して**保存する**。実行時解決に頼らない）。

---

## 6. Asset Library（§14）

```ts
type BrandAsset = {
  id: BrandAssetId
  workspaceId: WorkspaceId
  category: 'logo' | 'color' | 'font' | 'uniform' | 'typography' | 'texture' | 'other'
  name: string                      // 'iXA Yellow'
  mediaAssetId: MediaAssetId | null // color/font は null のことがある
  value: string | null              // color なら '#FFD200'
  usageRule: string                 // 'ロゴは左上、最小マージン 40px' など Review が読む
}

type Location = {
  id: LocationId
  workspaceId: WorkspaceId
  name: string                      // 'iXA CUP 会場'
  description: string
  referenceAssetIds: MediaAssetId[]
}

type MotionTemplate = {
  id: MotionTemplateId
  workspaceId: WorkspaceId
  key: string                       // Remotion composition id と 1:1
  name: string
  paramsSchema: JsonSchema          // UI フォームと検証を自動生成する
  previewAssetId: MediaAssetId | null
}
```

既存フッテージは `MediaAsset` (`origin.type = 'upload'`) にタグを付けて扱う。専用テーブルは作らない。

---

## 7. Music

```ts
type MusicTrack = {
  id: MusicTrackId
  projectId: ProjectId
  mediaAssetId: MediaAssetId
  title: string
  isMaster: boolean                 // プロジェクトの尺を決める1曲
  offsetSec: Seconds                // タイムライン上の開始位置（通常 0）
}
```

**マスターの規則**（PHASE 8 / ADR-0022）
- マスターは Project に**常にちょうど 1 曲**（楽曲が 1 曲以上あるとき）。最初の 1 曲は必ずマスター
- 付け替えは `setMaster`（他は降格）。題名・オフセット・音量の変更（`UpdateMusicTrackPatch`）ではマスターを変えない
- マスターを消したら、残りで最初に登録した曲をマスターにする（`nextMasterAfterRemoval`）。削除はソフトデリート

```ts
type MusicAnalysis = {
  id: MusicAnalysisId
  musicTrackId: MusicTrackId
  analyzerVersion: string           // 再解析の判定に使う
  bpm: number
  bpmConfidence: number
  beats: Seconds[]                  // 全ビート
  downbeats: Seconds[]              // 小節頭
  sections: MusicSection[]
  energyCurve: { hopSec: Seconds; values: number[] }   // 0..1 に正規化
  onsets: Seconds[]
  drops: Seconds[]                  // エネルギー急変点
  waveformPeaksKey: string          // UI 描画用のピークデータ（ストレージ上）
  createdAt: Date
}

type MusicSection = {
  start: Seconds
  end: Seconds
  label: 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'break' | 'drop' | 'outro'
  energy: number
}
```

**Shot のタイミングは原則ビートにスナップする**。スナップ関数は `packages/timeline` が持つ。

---

## 8. Script / Sequence

```ts
type Script = {
  id: ScriptId
  projectId: ProjectId
  currentVersionId: ScriptVersionId | null
}

type ScriptVersion = {
  id: ScriptVersionId
  scriptId: ScriptId
  version: number
  content: string                   // Markdown
  authoredBy: 'human' | 'ai'
  createdAt: Date
}

type Sequence = {
  id: SequenceId
  projectId: ProjectId
  order: number
  name: string                      // 'Aメロ / 過去の回想'
  musicSectionLabel: string | null  // MusicSection との紐付け（任意）
  notes: string
}
```

---

## 9. Shot（最重要）

```ts
type Shot = {
  id: ShotId
  projectId: ProjectId
  sequenceId: SequenceId | null
  order: number                     // プロジェクト内の通し順（1始まり、連番でなくてよい）
  code: string                      // 'shot_014' — 人間が呼ぶ名前。プロジェクト内一意

  // タイミング: Shot がマスタータイムラインの VIDEO1 上の位置を所有する（§下記の決定参照）
  startSec: Seconds                 // タイムライン上の位置
  durationSec: Seconds              // 編集尺。end = start + duration（ビートスナップ済み）
  sourceInSec: Seconds              // 採用 Take のメディア内の開始オフセット（ADR-0011）

  // 演出
  description: string               // 'iXA CUP決勝で takepi が勝利'
  dialogue: string | null
  camera: ShotCamera
  mood: string | null

  // 場所。ひと続きのカットなので 1 つだけ持つ（ADR-0015）
  locationId: LocationId | null

  // 生成方式
  sourceType: ShotSourceType

  // 状態
  selectedTakeId: TakeId | null     // 外せる（PHASE 8）。外しても Take は消えず、状態は review へ戻る
  status: ShotStatus
  lockedAt: Date | null             // ロック中は自動再生成の対象外

  createdAt: Date
  updatedAt: Date
}

type ShotStatus =
  | 'draft'         // 記述のみ
  | 'ready'         // 生成可能（必要な参照が揃っている）
  | 'generating'
  | 'review'        // Take はあるが、まだ採用していない（画面: 採用待ち）
  | 'approved'      // Take を採用した（画面: 採用済み）。採用が決定で、別の承認は無い（ADR-0023）
  | 'blocked'       // 人間の判断待ち

type ShotCamera = {
  size: 'extreme_wide' | 'wide' | 'medium_wide' | 'medium' | 'medium_closeup'
      | 'closeup' | 'extreme_closeup' | 'insert'
  // アングルは三軸で持つ（水平位置 / 俯仰 / 景別）。size が景別に相当する。
  angleH: 'front' | 'front_left' | 'front_right' | 'side_left' | 'side_right'
        | 'back_left' | 'back_right' | 'back' | null
  angle: 'eye' | 'low' | 'high' | 'overhead' | 'dutch' | null
  lensMm: number | null
  movement: 'static' | 'pan' | 'tilt' | 'push_in' | 'pull_out' | 'tracking'
          | 'handheld' | 'crane' | 'orbit' | null
  movementIntensity: 'subtle' | 'moderate' | 'strong' | null
}

// Shot がどう作られるか。生成パイプラインの分岐はここだけで決まる。
type ShotSourceType =
  | { type: 'ai_video' }                                   // text/ref → video
  | { type: 'ai_image_to_video'; keyframeTakeId: TakeId | null }  // image生成 → video化
  | { type: 'still_image'; mediaAssetId: MediaAssetId | null; kenBurns: KenBurns | null }
  | { type: 'existing_footage'; mediaAssetId: MediaAssetId | null; inSec: Seconds; outSec: Seconds }
  | { type: 'motion_graphics'; templateKey: string; params: Record<string, unknown> }
  | { type: 'generated_graphic'; mediaAssetId: MediaAssetId | null }
```

### 決定: 生成尺と編集尺を分ける（ADR-0011）

動画生成モデルの多くは任意の秒数を出せない（Veo は 4/6/8 秒、Kling は 5/10 秒のみ）。
ビートにスナップした編集尺と一致することはまずない。したがって:

- **生成尺** = 編集尺をモデルの対応値へ**切り上げ**た値。`ShotGenerationSpec.durationSec` に入る。
- **編集尺** = `Shot.durationSec`。ビートスナップ済みの、タイムライン上の実際の尺。
- 余った分は `Shot.sourceInSec` でトリムする。トランジションの重なりにも使う。
- `sourceInSec` は Take を差し替えても維持する（Take swap で編集が壊れないため）。

### 決定: Shot がタイムライン位置を所有する

VIDEO1 トラックは Shot 列の**投影**であり、独立したクリップ実体を持たない。
タイムライン上で Shot をドラッグ/トリムすると Shot の `startSec` / `durationSec` が更新される。
理由: 尺の真実が 2 箇所に分裂するのを防ぐ。Music Video では Shot 割り = 編集そのものである。

オーバーラップが必要なトランジション（クロスディゾルブ等）は `Transition` が担当し、
Shot の時間は重ならない前提を維持する（レンダリング時にのみ重ねる）。

```ts
type Transition = {
  id: TransitionId
  projectId: ProjectId
  fromShotId: ShotId
  toShotId: ShotId
  type: 'cut' | 'dissolve' | 'dip_to_black' | 'dip_to_white' | 'wipe' | 'whip_pan' | 'glitch'
  durationSec: Seconds              // cut は 0
}
```

### Shot と Character / Look

```ts
type ShotCharacter = {
  shotId: ShotId
  characterId: CharacterId
  lookId: CharacterLookId           // 必須。解決済みの値を保存する
  prominence: 'primary' | 'secondary' | 'background'
  order: number
}
```

### Shot と参照画像

```ts
type ShotReference = {
  id: ShotReferenceId
  shotId: ShotId
  mediaAssetId: MediaAssetId
  role: ReferenceRole
  weight: number                    // 0..1。Provider が重み対応しない場合は順位付けに使う
  order: number
  sourceKind: 'manual' | 'derived_character' | 'derived_look' | 'derived_location' | 'derived_brand'
}

type ReferenceRole =
  | 'subject'          // 人物の同一性
  | 'wardrobe'
  | 'location'
  | 'style'
  | 'brand'
  | 'start_frame'
  | 'end_frame'
  | 'previous_shot_last_frame'   // 連続性のため
```

`derived_*` の行は ReferenceResolver が Character/Look/Location から自動生成する。
手動追加分（`manual`）は常に優先度が高い。

---

## 10. Generation

### ShotGenerationSpec（Domain → Provider の境界）

Shot から**決定的に**組み立てられる、Provider 非依存の生成仕様。
Take に丸ごとスナップショットされる。これが再現性の中核。

```ts
type ShotGenerationSpec = {
  specVersion: 1
  shotId: ShotId
  sourceType: ShotSourceType['type']
  // 演出
  prompt: string                    // 合成済みの最終プロンプト（人間が読める）
  negativePrompt: string | null
  promptParts: {                    // 監査用。どの断片から組まれたか
    styleGuide: string
    shotDescription: string
    identityAnchors: string[]
    styleTokens: string[]
    colorPalette: string[]
    wardrobeTokens: string[]
    cameraFragment: string
    moodFragment: string | null
  }
  // 制約
  durationSec: Seconds              // 生成尺。編集尺をモデルの対応値へ切り上げた値（ADR-0011）
  aspectRatio: Project['aspectRatio']
  resolution: Resolution
  fps: number
  seed: number | null
  // 参照（解決済み・順序確定）
  references: Array<{
    mediaAssetId: MediaAssetId
    role: ReferenceRole
    weight: number
  }>
  // カメラ
  camera: ShotCamera
}
```

### Shot の連続性

`Shot.continuityMode` は、直前の Shot と画を繋ぐ意図を保存する。

```ts
type ShotContinuityMode = 'independent' | 'previous_shot'
```

既定は `independent`。`previous_shot` のときだけ、前 Shot の採用 Take の最終フレームを
生成時の開始画像候補にする（ADR-0019 / ADR-0020）。

`specHash = sha256(canonicalJson(spec))` を Take に保存する。同一 hash の再生成は警告する。

### GenerationJob / Take

```ts
type GenerationJob = {
  id: GenerationJobId
  shotId: ShotId
  specHash: string
  requestedModel: ModelId | 'AUTO'
  resolvedModel: ModelId | null
  routerDecision: RouterDecision | null
  // 再生成の系譜。ここが唯一の正で、キューのペイロードには載せない（ADR-0008）。
  // 作った Take の parentTakeId / regenerationReason になる。通常の生成では両方 null。
  parentTakeId: TakeId | null
  regenerationReason: string | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  attempt: number
  providerJobRef: string | null     // 外部ジョブID
  error: { code: string; message: string; retryable: boolean } | null
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

type Take = {
  id: TakeId
  shotId: ShotId
  index: number                     // Shot 内の連番（1始まり、表示用）
  // 実体
  mediaAssetId: MediaAssetId
  // 再現性のためのスナップショット（Immutable）
  spec: ShotGenerationSpec
  specHash: string
  providerId: ProviderId
  modelId: ModelId
  providerParams: Record<string, unknown>   // 実際に送った Provider 固有パラメータ
  seedUsed: number | null
  // 計測
  costUsd: number
  generationTimeSec: number
  // 系譜
  parentTakeId: TakeId | null       // 再生成元
  regenerationReason: string | null
  // 状態（Take 自体は Immutable。この 2 つのみ後から変わる）
  reviewStatus: 'pending' | 'passed' | 'warned' | 'failed' | 'skipped'
  humanVerdict: 'unreviewed' | 'approved' | 'rejected'
  createdAt: Date
}
```

**Immutability 規約**: `spec` / `providerParams` / `mediaAssetId` / `costUsd` は作成後に更新しない。
「作り直し」は必ず新しい Take を作る。DB レベルでも UPDATE を避けること。

---

## 11. Review

```ts
type ReviewRun = {
  id: ReviewRunId
  takeId: TakeId
  reviewers: ReviewerType[]
  status: 'queued' | 'running' | 'done' | 'failed'
  verdict: 'pass' | 'warn' | 'fail' | null
  costUsd: number
  createdAt: Date
}

type ReviewerType =
  | 'identity'          // 人物一致（vision LLM + 参照画像）
  | 'continuity'        // 前後 Shot との整合
  | 'brand'             // ロゴ・色・ユニフォーム（決定的な色検査 + LLM）
  | 'composition'       // 構図
  | 'prompt_adherence'  // Storyboard 記述との一致
  | 'music'             // ビート／ドロップとの整合（決定的計算）
  | 'technical'         // 尺・解像度・fps・黒フレーム（決定的）

type ReviewFinding = {
  id: ReviewFindingId
  reviewRunId: ReviewRunId
  reviewer: ReviewerType
  severity: 'info' | 'warn' | 'fail'
  score: number | null              // 0..1
  message: string
  evidence: {                       // UI で指摘箇所を出すため
    frameSec: Seconds | null
    bbox: [number, number, number, number] | null
    comparedAssetId: MediaAssetId | null
  } | null
  suggestedPromptDelta: string | null   // 再生成ループが使う
}
```

**決定: 決定的に測れるものは LLM に聞かない。**
尺・解像度・fps・黒フレーム・ブランドカラーの有無・ビート整合は計算で判定する。
LLM は「人物が同じ人に見えるか」「構図が指示通りか」など判断が要るものに限定する。コストと再現性のため。

---

## 12. Regeneration Loop（§20）

```ts
type RegenerationPolicy = {
  projectId: ProjectId
  maxAttemptsPerShot: number        // 既定 3
  maxCostPerShotUsd: number         // 既定 2.0
  maxCostPerProjectUsd: number
  requireHumanApprovalAfter: number // 既定 2 回失敗で人間へ
  autoRegenerateOn: ReviewerType[]  // 既定 ['identity', 'technical']
}
```

ループ: `Generate → Review → fail → findings を集約 → prompt/seed/参照を調整 → 新 Take`。
policy のいずれかに抵触したら Shot を `blocked` にして人間に渡す。**無限ループを作らないこと。**

---

## 13. Timeline（§22）

トラック構成（固定・MVP）:

```
VFX      ← TimelineClip
TEXT     ← TimelineClip
VIDEO2   ← TimelineClip（オーバーレイ / インサート）
VIDEO1   ← Shot の投影（TimelineClip を持たない）
SFX      ← TimelineClip
MUSIC    ← MusicTrack の投影
```

```ts
type TimelineClip = {
  id: TimelineClipId
  projectId: ProjectId
  track: 'VFX' | 'TEXT' | 'VIDEO2' | 'SFX'
  startSec: Seconds
  durationSec: Seconds
  layer: number                     // 同トラック内の重なり順
  content: TimelineClipContent
  opacity: number
  createdAt: Date
}

type TimelineClipContent =
  | { type: 'media'; mediaAssetId: MediaAssetId; inSec: Seconds; outSec: Seconds; volume: number }
  | { type: 'text'; templateKey: string; params: Record<string, unknown> }
  | { type: 'motion_graphics'; templateKey: string; params: Record<string, unknown> }
```

`TimelineDocument` = Project + Shots + Transitions + TimelineClips + MusicTracks を
**1 つの純粋な JSON に畳んだもの**。これが プレビューとレンダリングの共通入力になる。

```ts
type TimelineDocument = {
  version: 1
  fps: number
  resolution: Resolution
  durationSec: Seconds
  video1: Array<{ shotId: ShotId; startSec; durationSec; mediaUrl: string; inSec: Seconds }>
  transitions: Transition[]
  clips: TimelineClip[]
  audio: Array<{ mediaUrl: string; startSec: Seconds; volume: number }>
}
```

---

## 14. Render

```ts
type RenderJob = {
  id: RenderJobId
  projectId: ProjectId
  scope: { type: 'full' } | { type: 'range'; start: Seconds; end: Seconds } | { type: 'shot'; shotId: ShotId }
  preset: 'preview_720p' | 'master_1080p' | 'master_4k' | 'social_vertical'
  timelineSnapshot: TimelineDocument   // Immutable。何をレンダリングしたかが常に分かる
  status: 'queued' | 'rendering' | 'encoding' | 'succeeded' | 'failed' | 'cancelled'
  progress: number                     // 0..1
  outputAssetId: MediaAssetId | null
  error: string | null
  createdAt: Date
  finishedAt: Date | null
}
```

---

## 15. 実装エージェントへの禁止事項

- Domain 層で `fetch` / `fs` / DB クライアントを使わない。
- Provider SDK の型を Domain の型に露出させない。
- Take を UPDATE しない（`reviewStatus` / `humanVerdict` を除く）。
- 時間をミリ秒やフレームで DB に保存しない。
- ここに無いテーブル・エンティティを勝手に追加しない。必要なら BLOCKED で報告する。
