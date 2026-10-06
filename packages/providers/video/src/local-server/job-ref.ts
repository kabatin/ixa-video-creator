import { ProviderError } from '@ixa/provider-core'
import { LocalServerJobId } from './api.js'
import type { LocalServerIdentity } from './identity.js'

/**
 * ジョブ参照は **手元の生成サーバのジョブ ID そのもの**。
 *
 * fal（`<秒>:<request_id>`）と違い、費用は常に 0 なので尺を運ぶ必要が無い。
 * 生成の記録（出来た大きさ・コマ数・seed）は完了時にサーバが返すので、それを raw に残す。
 *
 * 参照は出力のファイル名にも URL にも使う。**形の違うものは読まずに落とす**
 * （DB に残った値から `../` を含むパスを組み立てない）。
 */
const invalidRef = (identity: LocalServerIdentity): ProviderError =>
  new ProviderError(`${identity.label}のジョブ参照を解釈できません`, identity.providerId, false)

export const encodeLocalServerJobRef = (
  identity: LocalServerIdentity,
  jobId: string,
): string => {
  const parsed = LocalServerJobId.safeParse(jobId)
  if (!parsed.success) throw invalidRef(identity)
  return parsed.data
}

export const decodeLocalServerJobRef = (
  identity: LocalServerIdentity,
  ref: string,
): LocalServerJobId => {
  const parsed = LocalServerJobId.safeParse(ref)
  if (!parsed.success) throw invalidRef(identity)
  return parsed.data
}
