import { ModelId, ProviderId, type AspectRatio, type Resolution } from '@ixa/domain'
import type { ImageModelCapabilities, ImageModelDescriptor } from '@ixa/provider-core'

/**
 * Codex CLI の組み込み `image_gen` を画像 Provider として扱う（ADR-0012 / ADR-0029）。
 * CLI は「もう 1 つの Provider 実装」であり、呼び出し側は HTTP か CLI かを知らない。
 *
 * 実測（2026-09-28、codex-cli 0.154.0。ADR-0029）:
 * - `codex exec` で無人で完走する。1 枚 70 秒前後
 * - 横長は 1536×1024、縦長は 1024×1536、正方形は 1024×1024 で出る
 * - 参照画像（`-i`）はよく効く
 * 未確認の項目はコメントで残す。
 */
export const CODEX_CLI_PROVIDER_ID: ProviderId = ProviderId.parse('codex-cli')

export const CODEX_CLI_IMAGE_MODEL_ID: ModelId = ModelId.parse('codex-cli/image-gen')

/** 作る形。`label` は指示文に入れる言い方。 */
export type CodexFrame = Resolution & { readonly label: string }

const LANDSCAPE: CodexFrame = { width: 1536, height: 1024, label: '横長' }
const PORTRAIT: CodexFrame = { width: 1024, height: 1536, label: '縦長' }
const SQUARE: CodexFrame = { width: 1024, height: 1024, label: '正方形' }

/**
 * 比ごとに作る形。**Codex はこの 3 つの形でしか出さない**ので、近い形で作って
 * 呼び出し側が比に切り抜く（16:9 なら 1536×864）。主題が切れないよう指示文でも伝える。
 */
const FRAME_FOR: Readonly<Record<AspectRatio, CodexFrame>> = {
  '16:9': LANDSCAPE,
  '21:9': LANDSCAPE,
  '9:16': PORTRAIT,
  '4:5': PORTRAIT,
  '1:1': SQUARE,
}

export const codexFrameFor = (aspectRatio: AspectRatio): CodexFrame => FRAME_FOR[aspectRatio]

const CODEX_CLI_CAPABILITIES: ImageModelCapabilities = {
  referenceImages: {
    /**
     * **上限は未確認**（1 枚で効くことは実測）。過少に宣言しておけば ReferenceResolver が
     * 切り詰めるだけで済み、実行時の失敗にならない。
     */
    max: 4,
    roles: ['subject', 'wardrobe', 'location', 'style', 'brand'],
  },
  /** 作る大きさ（上の 3 つの形）。 */
  resolutions: [LANDSCAPE, PORTRAIT, SQUARE].map(({ width, height }) => ({ width, height })),
  /** 切り抜いた後の比。作る形とは `codexFrameFor` で対応させる。 */
  aspectRatios: ['16:9', '21:9', '9:16', '4:5', '1:1'],
  /** マスク指定の編集は `image_gen` にあるが、この Provider はまだ使わない（ADR-0029 の対象外）。 */
  maskEdit: true,
  /** **未確認**。`image_gen` に seed 指定の記述が無いため、無いものとして宣言する。 */
  seed: false,
  negativePrompt: false,
}

export const codexCliImageModel: ImageModelDescriptor = {
  id: CODEX_CLI_IMAGE_MODEL_ID,
  providerId: CODEX_CLI_PROVIDER_ID,
  label: 'Codex CLI (image_gen)',
  capabilities: CODEX_CLI_CAPABILITIES,
  qualities: {
    characterConsistency: 0.7,
    promptAdherence: 0.85,
    textRendering: 0.85,
  },
  economics: {
    /**
     * サブスク認証で動くため **1 回あたりのコストが取得できない**（ADR-0012）。
     * 0 として扱うと予算ガード（ARCHITECTURE.md §11）が効かない点に注意。
     * 数百枚を自動で回す用途には HTTP の画像 Provider を使うこと。
     */
    costPerImageUsd: 0,
    /** 実測 68〜76 秒（ADR-0029）。 */
    typicalLatencySec: 75,
  },
}

export const codexCliImageModels: readonly ImageModelDescriptor[] = [codexCliImageModel]
