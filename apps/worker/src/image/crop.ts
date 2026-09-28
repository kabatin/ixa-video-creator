import type { AspectRatio, Resolution } from '@ixa/domain'
import { probeMedia, runFfmpeg } from '@ixa/media'
import { cropRectFor } from './shape.js'

/**
 * 作った絵をプロジェクトの比に中央で切り抜き、PNG で書き出す（ADR-0029）。返すのは書き出した大きさ。
 * 比が合っていても書き出し直す（Provider が返す形式に依らず、取り込む物を PNG に揃える）。
 */
export const cropToAspect = async (input: string, output: string, aspect: AspectRatio): Promise<Resolution> => {
  const probe = await probeMedia(input)
  if (probe.width === null || probe.height === null) {
    throw new Error('作った絵の大きさを読めませんでした')
  }
  const rect = cropRectFor({ width: probe.width, height: probe.height }, aspect)
  const filter = `crop=${String(rect.width)}:${String(rect.height)}:${String(rect.x)}:${String(rect.y)}`
  await runFfmpeg(['-y', '-i', input, '-vf', filter, '-frames:v', '1', output])
  return { width: rect.width, height: rect.height }
}
