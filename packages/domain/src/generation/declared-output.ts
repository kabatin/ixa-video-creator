import { z } from 'zod'
import type { Take } from './take.js'

/**
 * Provider が「返したファイルはこの大きさだ」と申告した値（ADR-0045）。
 *
 * **「生成した大きさ」ではない。** 手元の生成サーバは、モデルが描いた大きさ（H3 の 16:9 なら
 * 1344x768）を頼んだ比へ切り抜いてから返す。申告はその**切り抜いたあと**の値で、
 * ファイルの実寸と一致するはずのもの。生成した大きさは別に記録してある（`generation`）。
 *
 * 持ち込んだ Take（アプリの外で作った）には申告が無いので null。
 */

export type DeclaredOutputSize = {
  readonly width: number
  readonly height: number
}

/**
 * 記録の中から必要な 2 つだけを取る。**Provider ごとに鍵の綴りが違う**ので
 * （生成は `mediaType`、解像度を上げる口は `media_type`）、綴りの揺れない
 * `width` / `height` だけを見る。形が違えば null にして、推測で埋めない。
 */
const Recorded = z.object({
  output: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
})

export const declaredOutputSize = (
  take: Pick<Take, 'providerParams'>,
): DeclaredOutputSize | null => {
  if (take.providerParams.kind !== 'http') return null
  const parsed = Recorded.safeParse(take.providerParams.request)
  return parsed.success
    ? { width: parsed.data.output.width, height: parsed.data.output.height }
    : null
}
