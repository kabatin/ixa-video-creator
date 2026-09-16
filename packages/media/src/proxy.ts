import { z } from 'zod'
import { runFfmpeg, type RunOptions} from './ffmpeg-runner.js'
import { probeMedia } from './probe.js'

export type ProxyOptions = {
  /** この高さを超えるときだけ縮小する。既定 720。 */
  maxHeight?: number
  /** H.264 の品質。小さいほど高品質。既定 26。 */
  crf?: number
}

const ProxySettings = z.object({
  maxHeight: z.number().int().positive().default(720),
  crf: z.number().int().min(0).max(51).default(26),
})

/**
 * 編集プレビュー用のプロキシを生成する（docs/ARCHITECTURE.md §7）。
 *
 * - アスペクト比は常に保つ。`scale=-2:H` で幅を偶数に丸めつつ自動計算する
 * - 素材の高さが maxHeight 以下ならスケールフィルタを一切かけない（引き伸ばさない）
 * - 音声が無い素材に無音トラックを作らない（`-an`）
 */
export const createProxy = async (
  inputPath: string,
  outputPath: string,
  options?: ProxyOptions,
  runOptions?: RunOptions,
): Promise<void> => {
  const { maxHeight, crf } = ProxySettings.parse({
    maxHeight: options?.maxHeight,
    crf: options?.crf,
  })

  const probe = await probeMedia(inputPath)
  const needsDownscale = probe.height !== null && probe.height > maxHeight

  const videoArgs = [
    ...(needsDownscale ? ['-vf', `scale=-2:${maxHeight}`] : []),
    '-c:v',
    'libx264',
    '-crf',
    String(crf),
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ]

  const audioArgs = probe.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']

  await runFfmpeg(['-y', '-i', inputPath, ...videoArgs, ...audioArgs, outputPath], runOptions)
}
