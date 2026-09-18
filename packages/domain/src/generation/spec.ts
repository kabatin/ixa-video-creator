import { z } from 'zod'
import { MediaAssetId, ShotId } from '../common/ids.js'
import { AspectRatio, Resolution, Seconds } from '../common/time.js'
import { ShotCamera } from '../shot/camera.js'
import { ReferenceRole } from '../shot/reference.js'
import { SourceTypeName } from '../shot/source-type.js'

/**
 * Domain と Provider の境界。Provider 非依存の生成仕様。
 * Take に丸ごとスナップショットされる。これが再現性の中核（ADR-0003）。
 */
export const ShotGenerationSpec = z.object({
  specVersion: z.literal(1),
  shotId: ShotId,
  sourceType: SourceTypeName,

  prompt: z.string().min(1),
  negativePrompt: z.string().nullable(),

  /** 監査用。最終プロンプトがどの断片から組まれたかを残す。 */
  promptParts: z.object({
    styleGuide: z.string(),
    shotDescription: z.string(),
    identityAnchors: z.array(z.string()),
    styleTokens: z.array(z.string()),
    colorPalette: z.array(z.string()),
    wardrobeTokens: z.array(z.string()),
    cameraFragment: z.string(),
    moodFragment: z.string().nullable(),
  }),

  /** 生成尺。編集尺をモデルの対応値へ切り上げた値（ADR-0011）。 */
  durationSec: Seconds,
  aspectRatio: AspectRatio,
  resolution: Resolution,
  fps: z.number().positive(),
  seed: z.number().int().nullable(),

  /** 解決済み・順序確定・切り詰め済みの参照。 */
  references: z.array(
    z.object({
      mediaAssetId: MediaAssetId,
      role: ReferenceRole,
      weight: z.number().min(0).max(1),
    }),
  ),

  camera: ShotCamera,

  /**
   * レビューの指摘から人が選んだ直し（PHASE 6.1）。
   *
   * **`optional` であることが重要。** `computeSpecHash` は `canonicalJson`（= `JSON.stringify`）
   * を掛けるため、値が `undefined` のキーは文字列から消える。差分が無いときにキーごと
   * 省けば、既に生成済みの Take のハッシュが 1 バイトも変わらない。
   * 逆に `corrections: []` を無条件に置くと全 Shot のハッシュが変わり、
   * 重複検知が黙って効かなくなる（画面には出ず、費用としてだけ現れる）。
   */
  corrections: z.array(z.string().min(1)).optional(),
})
export type ShotGenerationSpec = z.infer<typeof ShotGenerationSpec>

/**
 * 1 回の生成に添えられる直しの上限。
 *
 * **api・画面・DB の入力検証がこの 1 つを参照する。** 同じ数字を書き写すと必ずズレて、
 * 片方だけ通る入力が生まれる。
 */
export const MAX_CORRECTIONS = 5
export const MAX_CORRECTION_LENGTH = 500

/**
 * 直しの入力の検証。空白のみの要素は受け付けない（trim 済み・非空）。
 * API 境界と画面の両方がこれを使う。
 */
export const Corrections = z
  .array(z.string().trim().min(1).max(MAX_CORRECTION_LENGTH))
  .max(MAX_CORRECTIONS)
export type Corrections = z.infer<typeof Corrections>

/**
 * オブジェクトキーを再帰的にソートした JSON 文字列。
 * specHash を安定させるために必要（キー順が違うだけで別ハッシュになるのを防ぐ）。
 */
export const canonicalJson = (value: unknown): string => {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize)
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, normalize(val)]),
      )
    }
    return v
  }
  return JSON.stringify(normalize(value))
}
