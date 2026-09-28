import type { AspectRatio, Resolution } from '@ixa/domain'
import type { ImageModelDescriptor } from '@ixa/provider-core'

/**
 * 絵コンテの画像の大きさ（ADR-0029）。**モデルが作れる形で作り、プロジェクトの比に中央で切り抜く。**
 * Codex は横長 1536×1024 / 縦長 / 正方形の 3 つしか出さない（実測）ので、比そのものでは頼めない。
 */

type Orientation = 'landscape' | 'portrait' | 'square'

const ratioOf = (aspect: AspectRatio): number => {
  const [w, h] = aspect.split(':').map(Number)
  return (w ?? 1) / (h ?? 1)
}

const orientationOf = (ratio: number): Orientation =>
  ratio > 1.001 ? 'landscape' : ratio < 0.999 ? 'portrait' : 'square'

/** 比と同じ向きの、いちばん大きい形。モデルが言わない比なら同じ向きの言える比で頼む。 */
export const requestShapeFor = (
  model: ImageModelDescriptor,
  aspect: AspectRatio,
): { readonly resolution: Resolution; readonly aspectRatio: AspectRatio } => {
  const orientation = orientationOf(ratioOf(aspect))
  const { resolutions, aspectRatios } = model.capabilities
  const sameOrientation = resolutions.filter((r) => orientationOf(r.width / r.height) === orientation)
  const resolution =
    [...(sameOrientation.length > 0 ? sameOrientation : resolutions)].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0] ?? { width: 1024, height: 1024 }
  const aspectRatio = aspectRatios.includes(aspect)
    ? aspect
    : (aspectRatios.find((candidate) => orientationOf(ratioOf(candidate)) === orientation) ?? aspect)
  return { resolution: { width: resolution.width, height: resolution.height }, aspectRatio }
}

export type CropRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** 比に合う、いちばん大きい中央の矩形。もう合っていれば全体。 */
export const cropRectFor = (size: Resolution, aspect: AspectRatio): CropRect => {
  const target = ratioOf(aspect)
  if (Math.abs(size.width / size.height - target) < 0.005) {
    return { x: 0, y: 0, width: size.width, height: size.height }
  }
  if (size.width / size.height > target) {
    const width = Math.round(size.height * target)
    return { x: Math.floor((size.width - width) / 2), y: 0, width, height: size.height }
  }
  const height = Math.round(size.width / target)
  return { x: 0, y: Math.floor((size.height - height) / 2), width: size.width, height }
}
