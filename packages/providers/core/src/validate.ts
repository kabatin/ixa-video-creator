import { canProduceDuration } from '@ixa/domain'
import type { ShotGenerationSpec } from '@ixa/domain'
import type { VideoModelDescriptor } from './provider.js'

/**
 * 仕様がモデルの能力に収まるかを検査する。
 * 満たせない理由をすべて列挙する（1 つ見つけて止めない）。呼び出し側が原因をまとめて直せるため。
 */
export const validateAgainstCapabilities = (
  spec: ShotGenerationSpec,
  model: VideoModelDescriptor,
): string[] => {
  const caps = model.capabilities
  const violations: string[] = []

  if (!canProduceDuration(spec.durationSec, caps.durations)) {
    violations.push(`尺 ${spec.durationSec}s を出せない（対応: ${describeDurations(caps.durations)}）`)
  }

  if (!caps.aspectRatios.includes(spec.aspectRatio)) {
    violations.push(`アスペクト比 ${spec.aspectRatio} に非対応（対応: ${caps.aspectRatios.join(', ')}）`)
  }

  const hasResolution = caps.resolutions.some(
    (r) => r.width === spec.resolution.width && r.height === spec.resolution.height,
  )
  if (!hasResolution) {
    violations.push(`解像度 ${spec.resolution.width}x${spec.resolution.height} に非対応`)
  }

  if (!caps.fps.includes(spec.fps)) {
    violations.push(`fps ${spec.fps} に非対応（対応: ${caps.fps.join(', ')}）`)
  }

  if (spec.references.length > caps.referenceImages.max) {
    violations.push(
      `参照画像が ${spec.references.length} 枚あるが上限は ${caps.referenceImages.max} 枚`,
    )
  }

  const unsupportedRoles = [
    ...new Set(
      spec.references
        .map((r) => r.role)
        .filter((role) => !caps.referenceImages.roles.includes(role)),
    ),
  ]
  if (unsupportedRoles.length > 0) {
    violations.push(`未対応の参照ロール: ${unsupportedRoles.join(', ')}`)
  }

  if (caps.requiresStartFrame === true && !spec.references.some((r) => r.role === 'start_frame')) {
    violations.push('最初のフレーム（画像）が要る。Shot に最初のフレームを付けてください')
  }

  if (spec.seed !== null && !caps.seed) {
    violations.push('seed 指定に非対応')
  }

  if (spec.negativePrompt !== null && !caps.negativePrompt) {
    violations.push('negative prompt に非対応')
  }

  return violations
}

export const describeDurations = (d: VideoModelDescriptor['capabilities']['durations']): string =>
  d.mode === 'enum'
    ? d.values.join(' / ') + ' 秒'
    : `${d.min}〜${d.max} 秒${d.step === undefined ? '' : `（${d.step} 秒刻み）`}`

export const canHandle = (spec: ShotGenerationSpec, model: VideoModelDescriptor): boolean =>
  validateAgainstCapabilities(spec, model).length === 0
