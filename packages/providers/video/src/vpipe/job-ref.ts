import { ProviderError } from '@ixa/provider-core'
import { VpipeJobId } from './api.js'
import { VPIPE_PROVIDER_ID } from './descriptor.js'

/**
 * ジョブ参照は **vpipe-api のジョブ ID そのもの**。
 *
 * fal（`<秒>:<request_id>`）と違い、費用は常に 0 なので尺を運ぶ必要が無い。
 * 生成の記録（出来た大きさ・コマ数・seed）は完了時にサーバが返すので、それを raw に残す。
 *
 * 参照は出力のファイル名にも URL にも使う。**形の違うものは読まずに落とす**
 * （DB に残った値から `../` を含むパスを組み立てない）。
 */
const invalidRef = (): ProviderError =>
  new ProviderError(
    'ローカルの動画生成（vpipe）のジョブ参照を解釈できません',
    VPIPE_PROVIDER_ID,
    false,
  )

export const encodeVpipeJobRef = (jobId: string): string => {
  const parsed = VpipeJobId.safeParse(jobId)
  if (!parsed.success) throw invalidRef()
  return parsed.data
}

export const decodeVpipeJobRef = (ref: string): VpipeJobId => {
  const parsed = VpipeJobId.safeParse(ref)
  if (!parsed.success) throw invalidRef()
  return parsed.data
}
