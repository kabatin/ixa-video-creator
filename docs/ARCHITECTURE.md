# ARCHITECTURE PROPOSAL v1

Project: **ixa-video-creator** — AI ネイティブ映像制作プラットフォーム
Status: v1 / Architect レビュー済み / 実装開始可能
Architect: Claude Opus 5
Date: 2026-09-16

> 責任構造の注記: 当初の仕様書（非公開）は Claude Fable を Lead Architect と定めていたが、
> ユーザー指示により **Claude Opus 5 が Architect / Final Decision Maker を引き継いだ**。
> 「One Architect, Many Implementers」の原則（当初の仕様書）はそのまま維持する。

---

## 1. Product Definition

### 何を作るのか

単発の AI 動画生成サービスではなく、**一本の映像作品を完成させるための制作環境**を作る。

```
Idea → Script → Storyboard → Shot → Reference → Generation → Take
     → AI Review → Regeneration → Timeline → Music Sync → Motion Graphics
     → Render → Final Movie
```

この全工程が 1 つのデータモデルの上で連続していることが本システムの価値である。
「生成」だけを切り出したツールとの差はここにしかない。

### 成功条件

AI 動画が生成できることではない。

**人間がクリエイティブディレクションを行い、AI が制作実務を高速に処理し、
一本の完成した映像作品まで到達できること。**

最初の作品: **iXA CUP MUSIC VIDEO**（約 1 分 56 秒 / 和テイスト × 現代的 /
登場人物 ACQUA・Akira・takepi・hibiki / ブランド iXA Yellow・ロゴ・ユニフォーム・書道・墨）。

### 誰が使うのか

想定ユーザーは 1〜数名のクリエイティブディレクター。
「たくさんの人が同時に編集する」ことは MVP の要件ではない（当初の仕様書）。
代わりに「1 人が数百カットを短時間でディレクションできる」ことを最適化する。

---

## 2. Design Principles

実装判断に迷ったときは、この順に優先する。

1. **Shot First** — すべての機能は Shot に接続する。Shot に接続できない機能は作らない。
2. **Single Source of Truth** — 同じ事実を 2 箇所に持たない。特に「尺」と「参照」。
3. **Immutable History** — 生成結果を上書きしない。判断の根拠を消さない。
4. **Reproducibility** — 任意の Take について「何を入力したか」が完全に復元できる。
5. **Provider Neutrality** — Domain に Provider 語彙を持ち込まない。モデルは差し替わる前提で設計する。
6. **Deterministic over LLM** — 計算で判定できることを LLM に聞かない。速度・コスト・再現性のすべてで劣る。
7. **Human in the Loop by Default** — 自動化は必ず上限（回数・コスト）と停止条件を持つ。
8. **Agent-Readable Repository** — エージェントがアーキテクチャを推測しなくてよい状態を保つ。
9. **Vertical Slice First** — 機能単位ではなく、通し動作する縦串を先に作る。
10. **Boring Technology** — 実績のある枯れた技術を選ぶ。挑戦は AI 部分だけで十分に多い。

---

## 3. OSS Findings

当初の仕様書が挙げた 2 つの参考領域を調査した。
**結論から言うと、「Seedance Drama Maker」「AI Video Production Editor」という名前に
完全一致する著名 OSS は存在しない。** 近い実装を実際のソースまで確認し、事実を以下に整理する。
**Fork はしない。Greenfield で構築する**方針（当初の仕様書）は変わらない。

### 3-1. Character Reference / Storyboard 系

#### LocalMiniDrama（`xuanyustudio/LocalMiniDrama`, MIT, ★1708, 2026-09 時点で活発）

Seedance 2.0 を主軸に据えた、完全ローカルの短編ドラマ生成ツール。
Vue3 + Node/Express + SQLite(better-sqlite3) + Electron 28。
**この領域で最も設計が作り込まれている実装。** SQL マイグレーション原文まで確認した。

キャラクターテーブルが持つ列（マイグレーション 13 / 16 / 17 / 20 で追加されたもの）:

```sql
ALTER TABLE characters ADD COLUMN identity_anchors TEXT;     -- 同一性のアンカー特徴（言語化）
ALTER TABLE characters ADD COLUMN style_tokens TEXT;         -- スタイル記述
ALTER TABLE characters ADD COLUMN color_palette TEXT;        -- 配色
ALTER TABLE characters ADD COLUMN four_view_image_url TEXT;  -- 四面図（正面/側面/背面/斜め）
ALTER TABLE characters ADD COLUMN polished_prompt TEXT;      -- 四面図生成用に練り上げた最終プロンプト
ALTER TABLE characters ADD COLUMN stages TEXT;               -- 話数ごとの複数外見/衣装
```

storyboards テーブルはアングルを**三軸に構造化**している（マイグレーション 15）。

```
angle_h  水平位置   例: front_left
angle_v  俯仰      例: low
angle_s  景別      例: close_up
```

Seedance 2.0（Volcengine Omni）への複数参照画像の渡し方（`videoClient.js` 実コード）:

```js
const orderedUrls = [...(primary ? [primary] : []), ...refList.filter(u => u !== primary)];
const urls = orderedUrls.slice(0, 9);          // 最大 9 枚
body.content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' });
```

**取り入れる点（設計に反映済み）**
- **`stages` = 話数ごとの外見切替**は、本システムの `CharacterLook` と同じ発想。
  Identity と Look を分ける設計（§8）が実運用で必要とされている裏付けになる。
- **`four_view_image_url`（四面図）を採用する。** これが今回の調査で最も価値のある発見。
  Veo と Runway は**参照画像を 3 枚しか受け付けない**（§9）。
  人物の正面・側面・全身を個別に渡すと 3 枠を使い切ってしまい、
  衣装・ロケーション・ブランドの参照を入れる余地が無くなる。
  **1 枚の四面図に集約すれば、同じ情報量を 1 枠で渡せる。** → §8 に反映。
- **`identity_anchors` / `style_tokens` / `color_palette` の分割**を採用する。
  プロンプト断片を 1 本の文字列で持つより、再生成時に
  「identity が不一致 → anchors だけ強める」といった**部分的な調整**ができる。 → §8 に反映。
- **アングルの三軸構造化**のうち、本システムに欠けていた**水平位置（angle_h）**を追加する。

**取り入れない点 / 弱点**
- **Provider 抽象化が無い。** `videoClient.js` 単体が 4653 行あり、
  `protocol` 文字列で `callVolcengineOmniVideoApi` / `callKlingVideoApi` / `callVeo3VideoApi` …
  と分岐する手続き的な実装。モデル追加のたびにこのファイルが伸びる。
  → 本システムは capability 記述 + アダプタで分離する（ADR-0004）。
- **Take が一級市民でない。** 再生成は「失敗時に最大 3 回リトライ」「グループ単位の再実行」で、
  世代・コスト・レビュー結果を紐づける構造が無い。
- **AI Review が無い。** 良し悪しの判断は完全に人手。
- **音楽同期の概念が無い。**

#### Open-AI-Micro-Drama-Generator（`Anil-matcha/...`, ★497）

Python/FastAPI + Next.js。MuAPI という単一ゲートウェイ経由で各モデルを呼ぶ軽量パイプライン。

```python
class CharacterInScene(BaseModel):
    idx: int
    name: str
    static_features: str   # hair, build, face — unchanging
    dynamic_features: str  # clothing, accessories for this scene
    is_visible: bool = True
```

`static_features` / `dynamic_features` の分離は、本システムの Identity / Look 分離と同じ思想。
独立した 2 つの実装が同じ結論に達している点は、この分離の妥当性を強く支持する。

動画生成は `seedance-2-vip-image-to-video` を主力とし、失敗時に `kling-v2.1-master-i2v` へ
フォールバックする try/except 構造。

**注意: このリポジトリには LICENSE ファイルが存在しない**（GitHub API 上も `license: null`）。
再利用条件が不明なため、**コードは一切参照しない。設計の発想のみを参考にする。**

その他の弱点: 参照画像が 1 枚のみ（`images_list: [reference_url]`）、
continuity / regeneration の機構が無い、サンドボックス用のプレースホルダー返却コードが本番コードに混在。

### 3-2. Provider Architecture / Timeline 系

#### ai-video-production-editor（`LudwigKienle/...`, **GPL-3.0**, ★44）

名前が完全一致する唯一のリポジトリ。React + Electron + Vite。
DaVinci Resolve 風のページ構成（Media / Cut / Edit / Fusion / Color / Fairlight / Deliver）。

Provider 抽象化が `src/services/worldModelProviderRegistry.ts` に実装されている。

```typescript
export type WorldModelOption = {
  id: WorldModelId; providerId: WorldModelProviderId;
  label: string; description: string;
  supports: WorldModelInputType[];
  quality: 'draft' | 'standard' | 'advanced';
  costHint: string;
};
```

README の設計思想（原文）:
> "Model APIs move quickly, so adapters are maintained integration points rather than permanent contracts."

**Auto ルーティングが実装されている。** 被写体の種類でモデルを振り分ける
（人物 → Nano Banana / GPT Image 2、環境 → Seedream、タイポグラフィ → Ideogram、
 セリフ → Veo 3.1、演技 → Kling v3）。
本システムの Model Router（§10）と同じ発想が実運用されている。

**取り入れる点**
- モデルを `supports` / `quality` / `costHint` を持つ記述オブジェクトとして扱う（→ ADR-0004）。
  本システムはこれをさらに**バリデーションとスコアリングの両方**に使う点で踏み込む。
- 「アダプタは永続的な契約ではなく、保守され続ける統合点である」という割り切り。
  → 契約テストで乖離を検知する設計（§9）の根拠。

**注意: GPL-3.0 である。コードを取り込むと本プロジェクト全体が GPL に感染する。**
**設計の発想のみを参考にし、コードは一切コピーしない。**

**弱点**: Timeline と Take management に相当する独立したデータモデルが確認できなかった
（README 中に "timeline" は 1 回のみ出現、Clip / Track / Take / version / revision いずれも不在）。
近い概念は "Continuity review → Re-film queue" の記述のみ。

#### VideoSOS（`timoncool/videosos`, MIT, ★1.3k）

ブラウザ内完結の AI 動画制作エディタ。Next.js + Remotion + FFmpeg.wasm、永続化は IndexedDB。
fal.ai と Runware.ai の 2 系統を同時利用できる。
モデル記述は `endpointId` / `availableDimensions` / `hasNegativePrompt` / `availableSteps` を持つ
TypeScript の設定オブジェクトで、これも capability 宣言そのもの。
**生成物 1 件ごとにコストを記録し、プロバイダ・モデル・種別で集計する**（→ `Take.costUsd` / `budgetUsd`）。

**弱点**: IndexedDB によるローカル完結のため、端末を替えると資産が消え、
ライブラリをプロジェクト間で共有できず、サーバサイドの重いレンダリングもできない。
Take / バージョン管理も無い。

#### その他（参考）

- `MartinDelophy/ai-video-editor`（MIT, ★824）— ブラウザ内 WebGPU/WebCodecs。
  "versioned headless command runner" と ".timeline archive"、冪等な operation ID を持つ。
  ただし Take 概念は無い。Provider 抽象化は AI モデルの**配信元**（Hugging Face / ModelScope）の
  フェイルオーバーであり、生成モデルのプロバイダ抽象化ではない。
- `vSebas/OpenTake`（GPL-3.0）— Rust + Tauri。`opentake-domain` に Timeline/Track/Clip/Keyframe、
  `opentake-gen` に fal.ai / Replicate / OpenAI の BYOK プロバイダ抽象化。規模は小さい。
- `chatman-media/timeline-studio`（★212）— **MIT with Commons Clause**（商用利用に制約あり）。
- `OpenCut`（★約89,000）— ブラウザ完結の汎用エディタ。AI 生成の統合は本筋ではない。

### 3-3. 調査から得た結論

1. **スタックの選択は業界の収束点と一致している。**
   Next.js / TypeScript / BullMQ / S3互換 / Remotion は、この領域の複数の実装が独立に採った構成。
   ADR-0001 / 0006 / 0008 / 0010 はこの事実に支えられている。
2. **Identity と Look（static/dynamic、stages）の分離は、複数の実装が独立に到達した結論である。**
   §8 の設計は妥当と判断する。
3. **どの実装も `Take` を一級のドメインとして持っていない。**
   生成は「作って選ぶ」運用で、判断の履歴も再現性も残らない。
   当初の仕様書が要求する Shot First と Immutable Take は、**既存 OSS が埋めていない空白**である。
4. **AI Review と自動再生成のループを持つ実装は見つからなかった。** ここが最大の差別化点になる。
5. **音楽ドリブンの編集（ビート同期）を持つ実装も見つからなかった。**
   iXA CUP MV という最初の案件がそのまま独自性になる。
6. **ライセンスに注意が必要な参考実装がある。**
   `LudwigKienle/ai-video-production-editor` は GPL-3.0、
   `Anil-matcha/Open-AI-Micro-Drama-Generator` は LICENSE 不在、
   `chatman-media/timeline-studio` は Commons Clause 付き。
   **いずれもコードは一切コピーしない。設計の発想のみを参考にする。**

### 参考にしない点（意図的に異なる設計にする箇所）

| 一般的な実装 | 本プロジェクトの判断 | 理由 |
|---|---|---|
| Shot と Timeline Clip を別実体にする | **Shot がタイムライン位置を所有**（ADR-0002） | MV では尺の二重管理が必ず破綻する |
| 生成結果を「候補」として運用でさばく | **Take をエンティティ化し追記のみ**（ADR-0003） | 制作物の根拠を消さない |
| レビューが無い / すべて LLM で行う | **決定的チェックを先に通す**（ADR-0005） | コストが 1 桁変わる |
| 巨大な if/switch で Provider を分岐 | **capability 記述 + アダプタ**（ADR-0004） | モデル追加でファイルが肥大しない |
| ブラウザ内 / IndexedDB で完結 | **サーバサイド（Postgres + S3 + Worker）** | ライブラリの共有と重いレンダリングに必要 |
| 生成尺 = 編集尺として扱う | **生成尺は切り上げ、編集尺はトリム**（ADR-0011） | モデルが離散的な秒数しか出せない |

出典:
[xuanyustudio/LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama),
[Anil-matcha/Open-AI-Micro-Drama-Generator](https://github.com/Anil-matcha/Open-AI-Micro-Drama-Generator),
[LudwigKienle/ai-video-production-editor](https://github.com/LudwigKienle/ai-video-production-editor),
[timoncool/videosos](https://github.com/timoncool/videosos),
[MartinDelophy/ai-video-editor](https://github.com/MartinDelophy/ai-video-editor),
[vSebas/OpenTake](https://github.com/vSebas/OpenTake),
[chatman-media/timeline-studio](https://github.com/chatman-media/timeline-studio),
[EvoLinkAI/ai-short-drama](https://github.com/EvoLinkAI/ai-short-drama)

---

## 4. Architecture

### 全体構成

```
                   ┌──────────────┐
                   │  apps/web    │  Next.js 15 / React 19
                   │  (UI)        │  @remotion/player でプレビュー
                   └──────┬───────┘
                          │ Hono RPC (型付き)
                   ┌──────▼───────┐        ┌──────────────┐
                   │  apps/api    │◄──────►│  PostgreSQL  │
                   │  Hono + zod  │        └──────────────┘
                   └──┬────────┬──┘
           enqueue    │        │  署名付きURL
                   ┌──▼─────┐  │        ┌──────────────┐
                   │ Redis  │  └───────►│ 手元のファイル│
                   │ BullMQ │           │ (または S3)  │
                   └──┬─────┘           └──────────────┘
                      │
        ┌─────────────▼─────────────────────────┐
        │           apps/worker                  │
        │  media / generation / review / render  │
        └──┬──────────┬──────────┬───────────┬───┘
           │          │          │           │
     ┌─────▼───┐ ┌────▼─────┐ ┌──▼──────┐ ┌──▼────────┐
     │ FFmpeg  │ │ Provider │ │ LLM     │ │ Remotion  │
     │         │ │ APIs     │ │ (Claude)│ │ Renderer  │
     └─────────┘ └──────────┘ └─────────┘ └───────────┘

                   ┌──────────────┐
                   │  apps/audio  │  Python / FastAPI
                   │  librosa     │  音楽解析のみ
                   └──────────────┘
```

### 素材の置き場（ADR-0041）

素材・書き出し・波形は **この機械のただのファイル**として置く（既定。`STORAGE_DRIVER=fs`）。

```
~/ixa-video-creator/storage/media/<workspaceId>/<mediaAssetId>/original.mp4   ← 正
~/Movies/ixa-video-creator/<作品名>/素材/CUT-01 Take 2 採用.mp4                ← 読める名前（ハードリンク）
```

- Finder で開けて Time Machine に乗る。Docker は Postgres と Redis だけ
- 署名付き URL は API が出す（`GET /files/{key}?exp=&sig=`。`Range` 対応）。**DB には保存しない**（規約 7）
- `STORAGE_DRIVER=s3` にすると S3 互換の置き場に戻せる（別の機械に分ける日のため）。
  そのときは署名を置き場自身が出すので、`/files` の口は登録しない

### レイヤリング

```
apps/*        IO・HTTP・UI・キュー配線のみ。ビジネスロジックを置かない。
packages/*    ロジック。
  domain/     純粋。IO 禁止。他 package に依存しない。型と規則の唯一の正。
  db/         domain の Port を実装する。SQL はここだけ。
  providers/  外部 SDK をここで閉じる。domain 型のみを外に出す。
  generation/ 生成仕様の入力を DB から集める（domain の Port の実装）。
  timeline/   時間計算・ビートスナップ・TimelineDocument 構築（純粋）。
  render/     Remotion コンポジション + レンダリング実行。
  review/     レビュアー実装（決定的 + LLM）。
  music/ media/ storage/ llm/ ui/ config/
```

`generation` が独立したパッケージなのは、**api と worker の両方が同じ入力から
同じ仕様を組み立てる必要があるため**（ADR-0003 の再現性）。apps 同士は import
できないので、片方の app に置くと必ずもう片方が空実装のまま取り残される。
実際に `apps/api` へ置いたときに worker だけが古い実装のまま残り、specHash が
食い違って全生成が spec_drift で失敗した（`docs/LESSONS.md`「規則を 2 箇所に書くと、必ずズレる」）。

**依存の向きは常に `apps → packages → domain`。逆流は禁止。**
この規則は `eslint-plugin-boundaries` で機械的に強制する。

| from | import できる先 |
|---|---|
| `domain` | **domain のみ**（他のどのパッケージも import できない） |
| `packages/*` | domain と他の `packages/*`。**`providers` は import 禁止** |
| `packages/providers/*` | domain / packages / 他の providers |
| `apps/*` | すべて |

`providers` を独立させているのは、**外部 SDK を一般ロジックへ漏らさないため**。
タイムライン計算やメディア処理が特定 Provider に依存し始めると、Provider の差し替えができなくなる。

**注意**: このプラグインは既定のリゾルバだと本リポジトリの `import './foo.js'`（実体は `.ts`）を
解決できず、**境界チェックを黙って素通りする**。`eslint-import-resolver-typescript` が必須。
設定を変えたら、わざと違反を作って実際にエラーになることを確認すること。

---

## 5. Domain Model

完全な定義は **`docs/DOMAIN.md`** にある。ここでは骨格のみ示す。

```
Workspace
 ├─ Character ─┬─ CharacterIdentityImage      (同一性: face_front / face_side / …)
 │             └─ CharacterLook ── CharacterLookImage   (時系列の外見)
 ├─ BrandAsset / Location / MotionTemplate
 └─ Project
     ├─ MusicTrack ── MusicAnalysis
     ├─ Script ── ScriptVersion
     ├─ Sequence
     │   └─ Shot ─┬─ ShotCharacter (character + look)
     │            ├─ ShotReference
     │            ├─ GenerationJob
     │            ├─ Take ─┬─ ReviewRun ── ReviewFinding
     │            │        └─ MediaAsset
     │            └─ Transition
     ├─ TimelineClip   (TEXT / VFX / VIDEO2 / SFX)
     └─ RenderJob ── MediaAsset
```

`MediaAsset` がすべてのファイルの唯一の実体。人物写真も生成動画も最終 MP4 も同じ扱い。

### 重要な不変条件

- Shot の時間は互いに重ならない（重なりは `Transition` が表現する）。
- Shot が Character を参照するとき Look は必ず解決済みの値で保存される。
- Take は `reviewStatus` / `humanVerdict` 以外を更新しない。
- 署名付き URL を DB に保存しない。

---

## 6. Shot Architecture

Shot は「1 カット」であり、同時に以下すべてのハブである。

```
             ┌── 演出情報 (description / camera / mood)
             ├── 登場人物 (ShotCharacter → Character + Look)
             ├── 参照画像 (ShotReference: 手動 + 自動導出)
  Shot ──────┼── 生成方式 (ShotSourceType の判別共用体)
             ├── 生成履歴 (Take[])
             ├── 採用 (selectedTakeId)
             └── 尺 (startSec / durationSec) ← タイムライン位置そのもの
```

### SourceType が唯一の分岐点

Shot がどう作られるかは `sourceType` だけで決まる。パイプラインの分岐をここに集約する。

| sourceType | 生成方法 |
|---|---|
| `ai_video` | テキスト + 参照画像 → 動画（1 ステップ） |
| `ai_image_to_video` | まずキーフレーム画像を生成 → それを起点に動画化（2 ステップ） |
| `still_image` | 静止画 + Ken Burns（レンダラ側で動きを付ける） |
| `existing_footage` | 既存素材の in/out 指定。生成しない |
| `motion_graphics` | Remotion テンプレート + パラメータ |
| `generated_graphic` | 画像生成のみ（ロゴ演出・書道など） |

`ai_image_to_video` を独立させたのは、**キャラクター一貫性の主戦場が画像生成側にある**ため。
画像で人物を確定させてから動かす方が、動画モデルに直接投げるより一貫性が高い。
キーフレーム自体も Take として管理する（`keyframeTakeId`）。

### Shot のライフサイクル

```
draft ──(参照が揃う)──► ready ──(生成)──► generating ──► review
                                                          │
                     ┌────────────────────────────────────┤
                     │                                    │
              (承認) ▼                            (再生成) │
                 approved                                 │
                     ▲                                    ▼
                     └──────────────────────────────── blocked
                                              (上限到達 / 人間待ち)
```

---

## 7. Asset Architecture

### 原則: ファイルは必ず MediaAsset を経由する

アップロードも生成結果もレンダリング出力も、すべて `MediaAsset` として登録される。
`origin` フィールドで出自を区別する（`upload` / `generated` / `rendered` / `derived`）。

### 取り込みパイプライン

```
1. API が署名付き PUT URL を発行（`fs` なら `PUT /files/...`、`s3` なら置き場の URL）
2. クライアントが直接アップロード（`fs` では API が受けて流し読みのまま書く。ADR-0041）
3. クライアントが完了を API に通知
4. media キューに投入
   ├─ ffprobe でメタデータ取得 → MediaProbe
   ├─ sha256 を計算 → 重複排除
   ├─ プロキシ生成（720p / H.264 / faststart）← 編集プレビュー用
   ├─ サムネイル生成
   └─ ポスターフレーム抽出（Review 用、等間隔 N 枚）
5. MediaAsset を ready にする
```

**プロキシを必ず作る理由**: 4K 素材をブラウザで直接扱うとプレビューが破綻する。
編集中は常にプロキシ、最終レンダリングのみオリジナルを使う。

### ライブラリの粒度

| 種別 | 実体 | スコープ |
|---|---|---|
| Character | `Character` + `CharacterLook` | Workspace（プロジェクト横断で再利用） |
| Brand | `BrandAsset` | Workspace |
| Location | `Location` | Workspace |
| Existing Footage | `MediaAsset` + タグ | Project または Workspace |
| Generated Media | `MediaAsset`（`origin.type='generated'`） | Project |
| Audio | `MediaAsset` + `MusicTrack` | Project |
| Motion Graphics | `MotionTemplate` | Workspace |

既存フッテージに専用テーブルを作らない。`MediaAsset` にタグを付けるだけで足りる。

---

## 8. Character / Look Architecture

当初の仕様書の要求「同一人物が時系列によって外見を変更できること」を、
**Identity と Look の 2 層**で実装する。

```
Character: takepi
  identityAnchors: ["20代日本人男性", "細身", "切れ長の鋭い目"]  ← Look で変わらない特徴のみ
  styleTokens:     ["硬質な光", "シネマティック"]
  colorPalette:    ["#1A1A1A", "#FFD200"]
  identityImages:
    four_view   (isPrimary)   ← 正面/側面/背面/斜めを 1 枚に集約したターンアラウンドシート
    face_front
    full_body

  Looks:
    IXA_CUP_PAST  (era: 2019)
      wardrobeTokens: ["黒髪短髪", "iXA 2019 ユニフォーム", "20歳"]
      canonicalFrameAssetId: null → 最初の承認 Take のフレームを昇格
      images: wardrobe, full_body
    SFL_CURRENT   (isDefault, era: 2026)
      wardrobeTokens: ["明るい茶髪", "SFL ジャージ", "26歳"]
      images: wardrobe, hair, full_body
```

### プロンプト断片を役割ごとに分割する

`promptFragment` を 1 本の文字列で持たず、
`identityAnchors` / `styleTokens` / `colorPalette` / `wardrobeTokens` に分ける。

理由は**再生成ループで部分的に調整できるようにするため**（§13）。
「identity review が fail → anchors だけを強調して再生成」が機械的に書ける。
1 本の文字列だと、どこを強めるべきか LLM に判断させることになり、再現性が落ちる。

### 四面図（four-view）を使って参照枠を節約する

**Veo と Runway は参照画像を 3 枚しか受け付けない**（§9 の表）。
人物の正面・側面・全身を個別に渡すと 3 枠を使い切り、
衣装・ロケーション・ブランドの参照を入れる余地が無くなる。

そこで **`role: 'four_view'`** の識別画像を用意する。
正面・側面・背面・斜めを 1 枚にまとめたターンアラウンドシートであり、
**1 枠で同じ情報量を渡せる。**

```
参照枠が 3 枚しかないモデルの場合:
  [1] takepi の four_view      ← 人物の同一性
  [2] IXA_CUP_PAST の wardrobe ← 衣装
  [3] 会場のロケーション写真    ← 背景

個別画像を使った場合（枠が足りない）:
  [1] face_front  [2] face_side  [3] full_body  → 衣装もロケーションも渡せない
```

四面図は Phase 2 でキャラクター登録時に画像モデルで生成し、人間が承認して確定させる。
ReferenceResolver は、モデルの参照枠が 4 枚未満のとき四面図を自動で優先する。

### ReferenceResolver — 設計の要

Shot から Provider へ渡す参照画像は、**自動導出 + 手動追加**の合成で決まる。
この解決ロジックを 1 箇所（`packages/domain/reference/resolver.ts`）に閉じる。

```
入力: Shot, ShotCharacter[], ShotReference[](manual), 選択されたモデルの capabilities
処理:
  0. モデルの参照枠が 4 枚未満なら、各 Character の four_view を 1 枚だけ使う（枠の節約）
  1. 各 ShotCharacter から identityImages(isPrimary優先) を role='subject' として展開
     Look に canonicalFrameAssetId があればそれを最優先する（ドリフト防止）
  2. 各 Look から lookImages を role='wardrobe' として展開
  3. Location / Brand を role='location' / 'brand' として展開
  4. 前 Shot の最終フレームを role='previous_shot_last_frame' として追加（連続性が要るとき）
  5. 手動追加分（sourceKind='manual'）を最優先で前に置く
  6. モデルの maxReferenceImages に合わせて優先度順に切り詰める
     優先度: manual > canonical_frame > four_view > subject(primary) > start_frame
             > 作品の手本の 1 枚目（ADR-0030） > wardrobe > location > brand > style
  7. モデルが role をサポートしない場合の縮退ルールを適用
出力: ShotGenerationSpec.references[]（順序確定・重み付き）
```

**この切り詰め規則が人物一貫性の品質を決める。** 必ずユニットテストを書く。

### 一貫性を担保する実務上の仕組み

1. **キーフレーム方式を既定にする** — `ai_image_to_video` で、まず参照画像 10 枚以上を
   受け付ける画像モデル（Gemini 3.1 Flash Image / Seedream v5 edit）で人物を確定させ、
   その 1 枚を動画モデルの start_frame にする。動画モデルの参照枚数制限を回避できる。
2. **Look ごとに "確定ショット" を持つ** — 最初に承認された Take の 1 フレームを
   その Look の canonical reference に昇格させ、以降の全 Shot で使う。ドリフトを止める。
3. **Identity Review で自動検査** — 生成結果と identityImages を vision LLM で比較する。

---

## 9. Provider Architecture

詳細は **ADR-0004**。

```ts
// packages/providers/core/types.ts
interface VideoProvider {
  readonly id: ProviderId
  readonly models: readonly VideoModelDescriptor[]
  submit(req: VideoGenerationRequest): Promise<ProviderJobHandle>
  poll(handle: ProviderJobHandle): Promise<ProviderJobStatus>
  cancel(handle: ProviderJobHandle): Promise<void>
}

type VideoModelDescriptor = {
  id: ModelId                       // 'seedance/v1-pro' など
  providerId: ProviderId
  capabilities: {
    durations: { mode: 'enum'; values: number[] } | { mode: 'range'; min: number; max: number }
    aspectRatios: AspectRatio[]
    resolutions: Resolution[]
    fps: number[]
    referenceImages: { max: number; roles: ReferenceRole[] }
    seed: boolean
    negativePrompt: boolean
    cameraControl: 'none' | 'preset' | 'prompt'
    audioGeneration: boolean
  }
  qualities: {                      // 0..1。Router のスコアリング用
    characterConsistency: number
    motion: number
    physics: number
    cameraControl: number
    promptAdherence: number
  }
  // latencySecPerOutputSec: 尺 1 秒を作るのにかかる秒。持つモデルは生成中の目安を作る尺から出す（estimateLatencySec）
  economics: { costPerSecondUsd: number; typicalLatencySec: number; latencySecPerOutputSec?: number }
}
```

同じ形で `ImageProvider` / `AudioProvider` / `LLMProvider` を定義する。

### 調査で判明した Provider の実態（2026-09 時点）

この表が capability 記述の初期値になる。**実装前に必ず実キーで疎通確認すること**
（多くの公式ドキュメントが JS レンダリングで、二次情報に頼った項目がある）。

| | Seedance 2.0 (ARK) | Seedance (fal.ai) | Veo 3.1 (Gemini API) | Kling | Runway Gen-4 系 |
|---|---|---|---|---|---|
| 実行方式 | 非同期 poll + webhook | 非同期 (subscribe) | 非同期 LRO poll | 非同期 poll + webhook | 非同期 poll |
| **尺** | 4〜15 秒（連続） | 4〜15 秒 | **4 / 6 / 8 秒のみ** | **5 / 10 秒のみ** | 2〜15 秒 |
| 解像度 | 480/720/1080p | 480/720p | 720/1080p/4K | standard/professional | ピクセル直接指定 |
| **参照画像** | **最大 9 枚** | **最大 12（画像/動画/音声 混在）** | **最大 3 枚** | 始点 + 終点（Pro のみ） | **最大 3 枚** |
| 始点/終点フレーム | 対応 | 対応 | 対応 | 対応（終点は Pro のみ） | 対応 |
| seed | 未確認 | 対応 | 対応 | 未確認 | 対応 |
| negative prompt | 未確認 | なし | なし | 未確認 | 未確認 |
| **カメラ制御** | プロンプトのみ | プロンプトのみ | プロンプトのみ | **構造化パラメータあり** | 未確認 |
| 概算単価 | 約 $0.14/秒（**Volcengine の人民元価格からの換算。BytePlus の公式レートは $0.04〜$0.78/秒で未確定**） | **$0.303/秒**（2.0 / 720p） | Std $0.40 / Fast $0.10 / Lite $0.05 /秒 | クレジット制 | Turbo $0.05 / 4.5 $0.12 /秒 |
| 出力 URL 期限 | 24 時間 | 未確認 | 2 日 | 24 時間 | 24〜48 時間 |

出典: Volcengine ARK / BytePlus ModelArk ドキュメント、fal.ai モデルページ、
ai.google.dev/gemini-api/docs/veo、docs.dev.runwayml.com/guides/pricing。

### 採用する Provider（2026-09-16 確定）

| 種別 | 実装 | 契約 |
|---|---|---|
| 動画生成 | **Seedance**。Phase 1 は **fal.ai**（カード不要で即開始）、本制作で **BytePlus ModelArk** へ移行（ADR-0013） | **唯一の有料 API。ただし fal.ai は初期クレジットで開始可** |
| 動画生成（手元・任意） | **MiniMax H3 Turbo** を **vpipe-api** 経由で（ADR-0031）、**Wan 2.2 TI2V-5B** を **wan-api** 経由で（ADR-0040）。`LOCAL_VIDEO_GENERATOR` に書いたものだけ。AUTO には選ばれない | 不要（手元の GPU。1 本 7〜25 分・**どちらも 1 本ずつ**で同時には作らない） |
| 画像生成 | **Codex CLI**（低volume・人が承認する用途） / BytePlus Seedream（高volume のキーフレーム） | 追加契約なし |
| LLM・Vision | **Claude Code CLI**（ADR-0012） | 追加契約なし |
| 音楽解析 | ローカルの librosa（ADR-0009） | 不要 |

Phase 1 は **fal.ai** で始める。カード不要・初期クレジットありで今日から着手でき、
出力 URL の期限が既定 7 日と長く、参照を 12 個まで受け付ける。
本制作（約 600 秒の生成）の段階で **BytePlus ModelArk** へ移す。単価差が約 $90 になるため。

BytePlus のキー 1 本で動画（Seedance）と画像（Seedream）の両方が使えるので、
Codex CLI の高volume 運用が不安定だった場合、追加契約なしで画像を HTTP 経路へ退避できる。

**注意**: BytePlus は QPS 2 / 同時タスク 3 というレート制限が報告されている（未確認）。
`generation` キューの Provider ごとの並列度は**設定可能にすること**。ハードコード禁止。

### この表から導かれた設計判断

1. **尺が離散値のモデルが多い** → 生成尺と編集尺を分離する（**ADR-0011**）。
   ビートスナップした尺をそのまま生成に使える前提で設計してはいけない。
2. **参照画像の上限が 3〜12 枚とばらつく** → ReferenceResolver の優先度つき切り詰めが必須（§8）。
   Veo / Runway の 3 枚制限では、4 人の登場人物を同時に参照させることができない。
   → **キーフレーム方式（`ai_image_to_video`）を既定にする根拠がここにある。**
   画像モデル（参照 10〜14 枚）で人物を確定させ、その 1 枚を動画モデルの start_frame にする。
3. **カメラ制御は Kling だけが構造化されている** → `cameraControl: 'none'|'preset'|'prompt'`
   の capability を持たせ、非対応モデルでは camera 指定をプロンプト断片へ縮退させる。
4. **全 Provider が期限付き URL を返す（24 時間〜2 日）** → 即ダウンロードを Worker の責務に固定する。
5. **同期 API が存在しない（画像生成の一部を除く）** → すべて非同期として扱う。

### 非同期実行の統一

調査の結果、動画・画像生成 API は **submit → ポーリング** が主流で、
同期で返るもの（OpenAI Images など）とは形が違う。
**すべてを非同期として扱い、同期 API は「即座に完了するジョブ」として包む。**
呼び出し側に分岐を作らない。

### 期限付き URL の扱い

多くの Provider は有効期限つき URL を返す（Seedance/Volcengine は約 24 時間）。
**返却 URL を DB に保存することを禁止する。** ジョブ完了時に即ダウンロードし、
自前ストレージに格納して `MediaAsset` を作る。これを Worker の責務として固定する。

---

## 10. Model Router

`provider = AUTO` の実装（当初の仕様書）。

```ts
selectModel(
  spec: ShotGenerationSpec,
  constraints: { maxCostUsd?: number; maxLatencySec?: number; allowedProviders?: ProviderId[] },
  registry: ProviderRegistry
): RouterDecision
```

**MVP ではルールベースの決定的スコアリングとし、LLM を使わない。**
理由: テスト可能・再現可能・無料・レイテンシゼロ。判断根拠を保存できる。

```
1. ハードフィルタ（capability による足切り）
   - 要求秒数を出せるか
   - 必要な参照画像枚数/ロールを受け付けるか
   - アスペクト比・解像度を出せるか
   - コスト上限・レイテンシ上限を満たすか
   → 0 件なら BLOCKED（人間に条件緩和を求める）

2. 重み付きスコアリング
   score = w1*characterConsistency * (人物が写るか)
         + w2*motion             * (カメラ/被写体の動きの強さ)
         + w3*physics            * (物理的整合が要る演出か)
         + w4*cameraControl      * (camera.movement が指定されているか)
         + w5*promptAdherence
         - w6*normalizedCost
         - w7*normalizedLatency
   重みは Project 設定で調整可能（品質優先 / コスト優先）。

3. 決定を RouterDecision として保存
   { modelId, score, reason, rejected: [{modelId, reason}], weightsVersion }
```

将来 LLM ルーターを足す場合も、この決定的ルーターを**フォールバック**として残す。

---

## 11. Generation Pipeline

```
[Shot] 
   │  SpecCompiler（純粋関数・テスト可能）
   │   ├─ styleGuide + description + character/look fragments + camera + mood を合成
   │   ├─ ReferenceResolver で参照を解決・順序確定・切り詰め
   │   └─ 尺/比率/解像度/fps を Project と Shot から確定
   ▼
[ShotGenerationSpec] ── specHash = sha256(canonicalJson)
   │  ModelRouter（AUTO のとき）
   ▼
[GenerationJob] ── generation キューへ
   │
   ├─ sourceType='ai_image_to_video' の場合:
   │     画像生成 → Take(kind=keyframe) → 承認 → start_frame として動画生成
   │
   │  ProviderAdapter.submit() → providerJobRef
   │  指数バックオフで poll()
   ▼
[完了] 
   │  期限付き URL から即ダウンロード
   │  → S3 へ格納 → ffprobe → プロキシ/サムネ/ポスターフレーム
   ▼
[MediaAsset] ──► [Take] (spec / providerParams / seed / cost / 所要時間をスナップショット)
   │
   ▼
[ReviewRun] （自動、§12 へ）
```

### プロンプト合成の方針

**LLM によるプロンプト拡張は既定で行わない。** 理由: 再現性が落ち、人間の意図がぼやける。
代わりに `promptParts` として構成要素を保持し、人間が最終プロンプトを直接編集できるようにする。
LLM 拡張は「AI Director」機能（Phase 3）で**明示的に呼ぶ**オプションとする。
どの AI（テキスト・画像・動画）を使うかは、この環境で見つかったものから画面で選ぶ（ADR-0032）。

### コストガード

生成をキューに入れる前に、必ず以下を検査する。抵触したら投入せず Shot を `blocked` にする。
- Project の `budgetUsd` 残額
- Shot ごとの `maxCostPerShotUsd`
- 同一 `specHash` の重複生成（警告）

---

## 12. Review Pipeline

詳細は **ADR-0005**。決定的チェックを先に通し、通過したものだけ LLM に回す。

```
[Take]
   │
   ├─ Stage 1: 決定的チェック（ffprobe / 計算。ほぼ無料・数秒）
   │    technical : 尺の一致 / 解像度 / fps / 全黒フレーム / 静止画化 / 無音
   │    music     : Shot 境界がビートに乗っているか / ドロップとの整合
   │    brand     : iXA Yellow の画面占有率 / ロゴ領域の輝度
   │    → fail があれば Stage 2 を実行しない（コストを払わない）
   │
   ├─ Stage 2: LLM 判定（vision。structured output を zod で強制）
   │    identity        : 抽出フレーム vs Character identityImages
   │    continuity      : 前 Shot 最終フレーム vs 本 Shot 先頭フレーム
   │    composition     : camera.size / angle の指示との一致
   │    prompt_adherence: description との一致
   │
   ▼
[ReviewRun] verdict = pass | warn | fail
[ReviewFinding[]] 各指摘に severity / 根拠フレーム / suggestedPromptDelta
```

**LLM には自由文を返させない。** すべて zod スキーマの structured output とし、
`suggestedPromptDelta` は再生成ループが機械的に使える形にする。

---

## 13. Regeneration Loop

```
Generate → Review → fail
   │
   ├─ findings を集約し、最も severity の高いものから対処
   │    identity fail  → 参照画像の優先度を上げる / キーフレーム方式に切替 / seed 変更
   │    motion fail    → camera fragment を強める / 別モデルへルーティング
   │    technical fail → パラメータ修正（尺・解像度）
   │
   ├─ ガード検査
   │    attempts >= maxAttemptsPerShot ?
   │    shotCost >= maxCostPerShotUsd ?
   │    projectCost >= budgetUsd ?
   │    attempts >= requireHumanApprovalAfter ?
   │    → いずれか true なら Shot を blocked にして停止
   │
   ▼
新しい Take（parentTakeId / regenerationReason つき）
```

**無限ループを構造的に作れないようにする。** ガード検査は Worker ではなく
`packages/domain` の純粋関数とし、ユニットテストで上限到達を必ず検証する。

---

## 14. Music Architecture

詳細は **ADR-0009**。

```
[音源アップロード] → MediaAsset
   │
   ▼  analysis キュー → apps/audio (Python / FastAPI / librosa)
   │
   ├─ bpm / bpmConfidence
   ├─ beats[]        全ビート（秒）
   ├─ downbeats[]    小節頭（拍子 + オンセット強度から推定）
   ├─ sections[]     Laplacian segmentation で境界検出 → LLM でラベル命名
   ├─ energyCurve    RMS を 0..1 に正規化（hop 単位）
   ├─ onsets[] / drops[]   エネルギー急変点
   └─ waveformPeaks  UI 描画用ピークデータ（ストレージへ）
   │
   ▼
[MusicAnalysis]（analyzerVersion つき。手動補正値は 'manual' として保存）
```

### タイムラインでの使われ方

- Shot のドラッグ/トリムは **ビートグリッドにスナップ**する（1/1, 1/2, 1/4 拍を選択可）。
- Section 境界が Sequence の初期分割案になる。
- Drop 位置に「ここで画を変える」マーカーを立て、AI Director（Phase 3）が Shot 割りに使う。
- Music Review が「Shot 境界とビートのズレ」を決定的に判定する。

**自動解析を信用しすぎない。** BPM とダウンビートは UI から手動上書きでき、
上書き値が常に優先される。1 曲しかない MVP では手動補正の方が速くて確実な場面がある。

---

## 15. Timeline

```
トラック構成（MVP 固定）
  VFX      ← TimelineClip
  TEXT     ← TimelineClip
  VIDEO2   ← TimelineClip（オーバーレイ / インサート）
  VIDEO1   ← Shot の投影（独立実体を持たない。ADR-0002）
  SFX      ← TimelineClip
  MUSIC    ← MusicTrack の投影
```

### TimelineDocument — プレビューとレンダリングの共通入力

Project / Shot / Transition / TimelineClip / MusicTrack を
**1 つの純粋な JSON に畳んだもの**が `TimelineDocument`。

```
DB ──► TimelineDocument ──┬──► @remotion/player  （ブラウザプレビュー）
      （純粋関数で構築）   └──► renderMedia()      （サーバレンダリング）
```

**プレビューとレンダリングが同じコードを通ることが、この設計の最大の利点。**
「プレビューでは合っていたのに書き出すとズレる」という事故が構造的に起きない。

### 機能範囲（当初の仕様書）

Drag / Trim / Move / Take swap / Waveform / Beat marker / Transition / Text / SFX / Preview / Export。
**高度な NLE は作らない。** キーフレームアニメーション、ネスト、マルチカム、
リップル編集の完全実装は Non Goal（当初の仕様書）。

---

## 16. Rendering

詳細は **ADR-0010**。

```
[RenderJob]
   │  TimelineDocument をスナップショット（何を書き出したかが常に残る）
   ▼
Stage 1: 素材の正規化（FFmpeg）
   すべての動画素材を共通中間形式へ（同一 fps / 同一解像度 / 同一コーデック）
   → Remotion の OffthreadVideo が安定してシークできる状態にする
   ▼
Stage 2: コンポジット（Remotion）
   TimelineDocument → Remotion composition props
   Shot / Transition / Text / Motion Graphics / VFX をすべて React で合成
   → 連番フレーム or 中間動画を出力
   ▼
Stage 3: 音声ミックス（FFmpeg）
   MUSIC + SFX + 素材音声をミックス、ラウドネス正規化（-14 LUFS 目安）
   ▼
Stage 4: 最終エンコード（FFmpeg）
   プリセット別に H.264/H.265 + AAC、faststart、カラースペース指定
   ▼
[MediaAsset]（最終 MP4）
```

### プリセット

| preset | 用途 | 仕様 |
|---|---|---|
| `preview_720p` | 確認用の高速書き出し | 1280×720 / CRF 26 |
| `master_1080p` | 納品（既定） | 1920×1080 / CRF 18 / yuv420p |
| `master_4k` | 納品（高解像度） | 3840×2160 / CRF 18 |
| `social_vertical` | SNS 用 | 1080×1920（再フレーミング規則つき） |

### 部分レンダリング

`RenderJob.scope` で `full` / `range` / `shot` を切り替えられる。
制作中は「この 10 秒だけ確認」が圧倒的に多い。全体レンダリングを待たせない。

---

## 17. Repository Structure

```
ixa-video-creator/
├── apps/
│   ├── web/              Next.js 15 / React 19 / Tailwind / @remotion/player
│   ├── api/              Hono + @hono/zod-openapi
│   ├── worker/           BullMQ consumers (media / generation / review / render / analysis)
│   └── audio/            Python 3.12 / FastAPI / librosa  ← 唯一の非 TS
├── packages/
│   ├── domain/           純粋な型・zod スキーマ・ロジック（IO 禁止）
│   │   ├── shot/  character/  take/  review/  reference/  routing/  ids/
│   ├── db/               Drizzle スキーマ + マイグレーション + リポジトリ実装
│   ├── generation/       GenerationContextSource の実装（api と worker が共有）
│   ├── providers/
│   │   ├── core/         interface / registry / descriptor 型
│   │   ├── video/        seedance / veo / kling / runway
│   │   ├── image/        openai / gemini / seedream
│   │   └── llm/          claude / openai / gemini
│   ├── media/            ffmpeg / ffprobe ラッパ、プロキシ・サムネ・フレーム抽出
│   ├── music/            ビート計算・スナップ・解析サービスクライアント
│   ├── timeline/         TimelineDocument 構築、時間計算（純粋）
│   ├── render/           Remotion コンポジション + レンダリング実行
│   ├── review/           決定的チェッカー + LLM レビュアー
│   ├── storage/          置き場の抽象（手元のファイル / S3 互換。署名付き URL / put / get）
│   ├── config/           環境変数の zod スキーマ
│   └── ui/               共有 React コンポーネント
├── docs/
│   ├── ARCHITECTURE.md   ← このファイル
│   ├── DOMAIN.md         ← ドメインモデルの唯一の正
│   ├── adr/              ← 技術決定の記録
│   ├── LESSONS.md        ← 実装で踏んだ失敗と、そこで決めた規則
│   └── CODEMAPS/         ← 自動生成のコードマップ
├── infra/
│   └── docker-compose.yml    Postgres / Redis（素材は手元のファイル。ADR-0041）
├── CLAUDE.md             コーディング規約
└── AGENTS.md             実装エージェント運用規約
```

---

## 18. API

`apps/api` は Hono + zod（ADR-0006）。1 route = 1 ファイル。

```
POST   /projects                       プロジェクト作成
GET    /projects?workspaceId=<ULID>    一覧（workspaceId は必須）
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id                   ソフトデリート

POST   /uploads/sign                   署名付き PUT URL 発行
POST   /uploads/complete               アップロード完了通知 → media キュー投入
GET    /media/:id
GET    /media/:id/url                  署名付き GET URL（都度発行）

POST   /projects/:id/music             音源紐付け
POST   /music/:id/analyze              解析キュー投入
GET    /music/:id/analysis
PATCH  /music/:id/analysis             BPM / downbeat の手動補正

GET    /characters
POST   /characters
POST   /characters/:id/identity-images
POST   /characters/:id/looks
POST   /looks/:id/images

GET    /projects/:id/shots
POST   /projects/:id/shots
PATCH  /shots/:id                      description / camera / sourceType / 尺
POST   /shots/:id/characters
POST   /shots/:id/references
POST   /shots/:id/reorder

POST   /shots/:id/generate             { model: ModelId | 'AUTO', count?: number }
GET    /shots/:id/takes
POST   /shots/:id/select-take          { takeId }
POST   /takes/:id/review
GET    /takes/:id/reviews
POST   /takes/:id/regenerate

GET    /projects/:id/timeline          TimelineDocument
PATCH  /projects/:id/timeline/clips
POST   /projects/:id/transitions

POST   /projects/:id/render            { preset, scope }
GET    /renders/:id

GET    /projects/:id/events            SSE（ジョブ進捗のリアルタイム通知）

POST   /webhooks/providers/:providerId 外部 Provider からのコールバック
```

### 規約

- レスポンスは `{ success, data?, error?, meta? }` の形で統一する。
- すべての入力を zod で検証する。検証エラーは 422 + フィールド単位のエラー。
- 進捗通知は SSE。WebSocket は MVP では使わない（複雑さに見合わない）。
- webhook は署名検証を必須とする。

---

## 19. Database

PostgreSQL 16 + Drizzle（ADR-0007）。

### テーブル一覧

```
workspaces
projects
media_assets                 (checksum_sha256 に UNIQUE 部分インデックス)
characters
character_identity_images
character_looks
character_look_images
brand_assets
locations
motion_templates
music_tracks
music_analyses               (JSONB: beats / downbeats / sections / energy_curve)
music_analysis_failures      (直近の解析の失敗。楽曲 1 件につき 1 行。頼み直すと消える)
scripts
script_versions
sequences
shots                        (project_id, order) に複合インデックス
shot_characters
shot_references
transitions
timeline_clips
text_styles                  (テロップの見た目に名前を付けたもの。当てると値をテロップへ写す / ADR-0028)
generation_jobs
takes                        (JSONB: spec / provider_params。追記のみ)
image_generation_jobs        (絵コンテの画像を作るジョブ。Shot の最初のフレームになる / ADR-0029。追記のみ)
upscale_jobs                 (出来た Take の解像度を上げるジョブ / ADR-0044。仕様を持たないので generation_jobs と別。追記のみ)
review_runs
review_findings
storyboard_draft_runs        (絵コンテ下書きの実行 1 回分)
storyboard_draft_items       (Shot ごとの案。中身は追記のみ。動くのは adopted_at だけ)
shot_edit_batches            (一括編集の記録と取り消し。中身は追記のみ。動くのは undone_at だけ)
render_jobs                  (JSONB: timeline_snapshot)
ai_settings                  (使う AI。この環境に 1 行だけ。無ければ環境変数が初期値 / ADR-0032)
voice_profiles               (声。ナレーター・キャラクターの声 / ADR-0038)
narration_lines              (ナレーション・セリフの原稿の行。位置（秒）を自分で持つ / ADR-0038)
narration_takes              (行の声の Take。追記のみ。後から変わるのは char_times だけ / ADR-0038)
voice_jobs                   (声・文字起こしのジョブ。掛かった額を持つ。追記のみ / ADR-0038)
project_audio_settings       (作品ごとの読み辞書・ダッキング・話している字の強調。無ければ既定 / ADR-0038・0039)
```

### 規約

- 主キーはすべて ULID（`text`）。UUID v4 は使わない（時系列ソート性が欲しい）。
- 時間はすべて `double precision` の秒。ミリ秒・フレームを保存しない。
- JSONB は zod スキーマで読み書き両方を検証する。
- Shot の並びは `order` を **1000 刻み**で採番し、挿入時に再採番しない（並べ替えコストを避ける）。
- `takes` テーブルは UPDATE を `review_status` / `human_verdict` 列に限定する
  （DB トリガで強制することを検討。ADR-0003）。
- 削除は原則ソフトデリート（`deleted_at`）。制作物の履歴を消さない。

---

## 20. Queue / Worker

BullMQ + Redis（ADR-0008）。

並列度は `WORKER_CONCURRENCY_<キュー名の大文字>`（例: `WORKER_CONCURRENCY_IMAGE=5`）で
**コードを触らずに変えられる**。下の表はその既定値。

| キュー | 並列度（既定） | ジョブ | 備考 |
|---|---|---|---|
| `media` | 8 | probe / proxy / thumbnail / frames | CPU バウンド |
| `generation` | Provider ごとに制限 | submit / poll / download | レート制限あり |
| `review` | 4 | 決定的チェック / LLM レビュー | |
| `render` | 1〜2 | Remotion レンダリング | CPU を占有する |
| `analysis` | 2 | 音楽解析（Python へ委譲） | |
| `regeneration` | 4 | 再生成の可否判定と投入 | review と分ける。レビューは LLM コストを払うため、再生成の失敗でやり直させない |
| `image` | 3 | 絵コンテの画像・キャラクターシート（ADR-0029・0035） | Codex CLI は契約の利用枠で動く。1 枚 63〜117 秒（平均 85 秒・83 枚の実測）で、その間この機械の CPU はほぼ使わない（外の API を待つ）。3 本同時で 3 枚 109 秒（直列なら 231 秒）・失敗 0 件を実測（2026-10-07） |
| `voice` | 1 | ナレーションの声・試しに読む・録音の文字起こし（ADR-0038） | 外部 API の回数の上限に配慮。whisper.cpp は手元の機械を大きく使う |
| `upscale` | 1 | 出来た Take の解像度を上げる（ADR-0044） | 手元の GPU を使うので 1 つずつ。順番は生成と同じ整理券で待つ（1 本 5 + 101 × ceil(コマ数 ÷ 21) 秒の実測） |

### 規約

- **DB の行が真実、キューは実行手段。** Redis が飛んでもジョブを DB から復元できること。
- すべてのジョブを冪等に書く。同じジョブが 2 回走っても結果が壊れないこと。
- 外部ジョブのポーリングは repeatable job ではなく、**指数バックオフ付きの再スケジュール**。
- 失敗は必ず `GenerationJob.error` に `{ code, message, retryable }` で記録する。
- リトライ回数の上限をキューごとに設定し、超過は DLQ に落として人間に見せる。

---

## 21. Vertical Slice

当初の仕様書の通り、機能単位ではなく**通し動作する縦串**を最初に作る。

```
Create Project → Upload Music → Music Analysis → Create Shot
  → Generate Video → Create Take → Timeline → Render MP4
```

このスライスが通った時点で、以下が同時に検証される。

- DB / ストレージ / キュー / Worker の配線
- Provider 抽象化が実際の API に耐えるか
- TimelineDocument がプレビューとレンダリングの両方で機能するか
- Remotion のレンダリング所要時間が実用的か
- 生成コストの実測値

**このスライスで検証されない仮定は、後で必ず問題になる。** だから最初に通す。

---

## 22. MVP Phases

| Phase | 内容 | 完了条件 |
|---|---|---|
| **0** | 基盤 | monorepo / DB / ストレージ / キュー / CI / docs が揃い、`pnpm dev` が動く |
| **1** | Vertical Slice | 上記の縦串が通り、10 秒の MP4 が書き出せる |
| **2** | Asset Library | Character / Look / Brand / Location 登録と、参照の自動解決が動く |
| **3** | Storyboard | Script / Sequence / Shot 一括作成、音楽セクションからの Shot 割り |
| **4** | Review & Regen | 決定的チェック + LLM レビュー + 上限つき自動再生成 |
| **5** | Timeline 深化 | Take swap / Transition / Text / Motion Graphics / SFX / ビートスナップ |
| **6** | Production | iXA CUP MV の実制作、書き出しプリセット、性能改善 |

### MVP Definition of Done（当初の仕様書）

Project作成 / Music Upload / Music Analysis / Character登録 / Brand登録 / Script /
Storyboard / Shot編集 / Reference / Generation / Multiple Takes / Take selection /
AI Review / Timeline / Music Sync / Rendering / MP4 Export

**そして iXA CUP MV が完成できること。** これが唯一の合格判定である。

---

## 23. Agent Execution Strategy

### 構造

```
Architect (Claude Opus 5 / メインセッション)
  設計 → タスク分解 → File Ownership 割当 → レビュー → 統合 → 次の設計判断

Implementation Agents (Opus サブエージェント / Codex)
  実装 → テスト → 報告   ※ 設計判断はしない
```

運用規約は **`AGENTS.md`**。BLOCKED プロトコル、完了報告フォーマット、禁止事項を定義済み。

### タスクを投げる前に Architect が必ず確定させるもの

Goal / Context / Files (ownership) / Interfaces / Inputs / Outputs /
Constraints / Non-goals / Acceptance Criteria / Tests。

**エージェント側で仕様を推測する必要がある状態で投げない。** これを守れないなら分解が足りない。

### エージェント選択の目安

| 種別 | 向く作業 |
|---|---|
| Opus | 複雑な実装 / 多ファイル変更 / 既存コード理解 / 難しいバグ / 統合 |
| Codex | CRUD API / migration / UI component / adapter / test / 反復的な実装 |

### 並列化の原則

- 同じファイルを 2 つのエージェントに触らせない。
- 共通ファイル（`packages/domain`、DB スキーマ、ルート設定）は Architect が所有する。
- 依存のあるタスクは同時に出さない。先に Interface だけ Architect が確定させる。

---

## 24. Risks

| # | リスク | 影響 | 対策 |
|---|---|---|---|
| R1 | ~~**Remotion の商用ライセンス**~~ **解決済み（2026-09-16）**。個人開発かつ操作者が本人のみのため Free License の対象。将来 Remotion を操作する人が増えたら人数が合算される点だけ再評価する | 低 | ADR-0010 で確定。`TimelineRenderer` Port は維持（テストスタブ用） |
| R2 | **キャラクター一貫性が現行モデルの限界を超える** | 作品品質に直撃 | 3 段構え: ①キーフレーム方式を既定化（§8） ②**四面図で参照枠を節約**し衣装・背景も同時に渡す ③Look ごとの canonical frame を最初の承認 Take から昇格させドリフトを止める。加えて Identity Review で自動検査し、最終判断は人間 |
| R3 | **生成コストが想定を超える** | 予算超過 | 概算: 116 秒 MV / 約 40 Shot / 平均 3 Take = 約 600 秒の生成。**fal.ai $0.303/秒 なら約 $180**、BytePlus がその半分なら約 $90。画像と LLM は CLI 経由で追加費用なし（ADR-0012）。**$90〜$200 が現実的なレンジ**。Project 単位の budgetUsd で事前ガードし、Phase 1 で実測する |
| R4 | **Provider API の破壊的変更・提供終了** | 生成不能 | 画像系は既に Imagen 4 が停止予定など変動が激しい。capability 記述 + 契約テストで乖離を早期検知。**fal.ai と BytePlus の 2 系統を常に動く状態に保つ**（ADR-0013） |
| R5 | **音楽解析（downbeat / section）の精度不足** | Shot 割りの手戻り | 手動補正 UI を最初から作る（ADR-0009） |
| R6 | **レンダリング時間が長すぎる** | 反復速度低下 | 部分レンダリング（scope: range/shot）とプロキシ運用。Phase 1 で実測する |
| R7 | **Python サービスの運用が重荷になる** | 開発速度低下 | 責務を音楽解析だけに限定。契約は JSON 1 本。落ちても他機能が動く設計 |
| R8 | **並列実装によるアーキテクチャ崩壊** | 技術的負債 | File Ownership の厳格運用、`eslint-plugin-boundaries` による依存方向の機械的強制、Architect の全 PR レビュー |
| R9 | **音ズレ** | 作品として成立しない | 時間を秒 float で統一、フレーム変換を 1 箇所に集約。プレビューとレンダリングが同一コードパス（§15） |
| R10 | **Shot が時間を所有する設計の制約** | 表現の制限 | VIDEO2 トラックで逃がす。破綻したら ADR-0002 を見直す |
| R12 | **Provider 単価・レート制限に未確認の項目が残る** — BytePlus の秒単価は $0.04〜$0.78 と幅があり、QPS 2 / 同時タスク 3 も報告値にすぎない | 予算とスケジュールの見積り誤差 | 二次情報のまま本制作に入らない。Phase 1 で fal.ai の実測値を取り、BytePlus 登録後に再実測して ADR-0013 を更新する |
| R11 | **参考 OSS のライセンス汚染** — `LudwigKienle/ai-video-production-editor` は GPL-3.0、`Anil-matcha/Open-AI-Micro-Drama-Generator` は LICENSE 不在、`chatman-media/timeline-studio` は Commons Clause 付き | 法務 | **コードを一切コピーしない。設計の発想のみ参考にする。** 実装エージェントにも `AGENTS.md` で明示する |

---

## 25. ADR

| ID | 決定 |
|---|---|
| ADR-0001 | TypeScript モノレポ + Python は音楽解析のみ |
| ADR-0002 | Shot がタイムライン位置を所有する |
| ADR-0003 | Take は Immutable、生成入力は完全スナップショット |
| ADR-0004 | Capability 記述による Provider 抽象化 |
| ADR-0005 | 決定的に測れるものは LLM に判定させない |
| ADR-0006 | API は Hono + zod（OpenAPI 自動生成） |
| ADR-0007 | PostgreSQL + Drizzle ORM |
| ADR-0008 | ジョブキューは BullMQ（Redis） |
| ADR-0009 | 音楽解析は librosa を既定とし、解析器をプラガブルにする |
| ADR-0010 | Remotion をタイムラインレンダラにする（Renderer Port 付き） |
| ADR-0011 | 生成尺は切り上げ、編集尺はトリムで作る |
| ADR-0012 | CLI を Provider 実装の一形態として扱う |
| ADR-0013 | Seedance は fal.ai で始め、本制作で BytePlus ModelArk へ移る |

---

## 26. Open Questions

実装を進める上で、**ユーザーの回答が必要**なもの。回答待ちの間も Phase 0 は進行できる。

| # | 質問 | なぜ必要か |
|---|---|---|
| ~~Q1~~ | ~~Remotion の Company License~~ **解決済み（2026-09-16）**: 個人開発・操作者は本人のみ → Free License 対象、費用なし。ADR-0010 を確定した | — |
| ~~Q2~~ | ~~使える Provider の API キー~~ **方針確定（2026-09-16）**: 動画 = Seedance（Phase 1 は **fal.ai**、本制作で **BytePlus ModelArk**、ADR-0013）、画像 = Codex CLI、LLM = Claude Code CLI（ADR-0012）。**fal.ai はカード不要で開始できるため、契約を待たずに着手できる** | — |
| Q3 | **iXA CUP MV の生成予算上限**（USD） | budgetUsd の既定値と、再生成ループの上限設定 |
| Q4 | MV の **出力仕様**（解像度・fps・アスペクト比・納品形式） | Project の既定値。16:9 / 1920×1080 / 30fps を仮置きしている |
| Q5 | **楽曲ファイル**は手元にあるか（尺 1:56 の確定版か） | Phase 1 の実データテストに使う |
| Q6 | **既存フッテージ**（過去の iXA CUP 映像等）は使えるか | `existing_footage` の優先度が変わる |
| Q7 | **キャラクター 4 名の参照素材**はあるか（写真・過去映像） | Character Identity の登録品質が作品品質を決める |
| Q8 | **デプロイ先**（ローカル完結 / 社内サーバ / クラウド） | ストレージとレンダリングの構成が変わる |
| Q9 | **納期**はあるか | Phase の刻み方と並列度が変わる |

---

## 27. 次のアクション

1. Phase 0 の実装計画と File Ownership 表を作成する。
2. Q1 / Q2 の回答を待たずに着手できる範囲（monorepo 雛形・DB スキーマ・domain 型）から並列起動する。
3. Q1 の回答次第で ADR-0010 を確定または差し替える。
