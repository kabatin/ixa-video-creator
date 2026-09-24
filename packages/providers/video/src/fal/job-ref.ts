import { ProviderError } from '@ixa/provider-core'
import { FAL_PROVIDER_ID } from './descriptor.js'

/**
 * ジョブ参照の符号化。形は **`<生成尺(秒)>:<request_id>`**。
 *
 * `VideoProvider.poll` は `ProviderJobHandle` しか受け取らず、仕様も要求も渡ってこない。
 * 一方 fal の応答には尺が入っておらず、**費用は「生成尺 × 単価」でしか出せない**。
 * Provider の中に Map を持つ手もあるが、ポーリングは BullMQ の遅延ジョブで最大 2 時間
 * 続き、その間に worker が再起動すれば Map は空になる。**そのとき費用が 0 に化ける。**
 * 0 は「無料だった」という嘘になり、費用メーターに実測として載る。
 *
 * `ProviderJobHandle.ref` は「不透明。中身の形は Provider ごとに異なる」と契約されており
 * （`packages/providers/core/src/provider.ts`）、DB では `provider_job_ref` の文字列として
 * そのまま保存・復元されるだけで、誰も中身を解釈しない。だからここに載せる。
 *
 * 尺を先に置くのは、request_id 側に `:` が混ざっても最初の 1 つで切れば曖昧にならないため。
 */
const SEPARATOR = ':'

export const encodeFalJobRef = (requestId: string, generationDurationSec: number): string => {
  if (requestId.trim() === '') {
    throw new ProviderError('fal の request_id が空です', FAL_PROVIDER_ID, false)
  }
  return `${String(generationDurationSec)}${SEPARATOR}${requestId}`
}

export type FalJobRef = {
  readonly requestId: string
  readonly generationDurationSec: number
}

/** **黙って 0 秒にしない。** 費用が 0 に化けるくらいなら失敗させる。 */
export const decodeFalJobRef = (ref: string): FalJobRef => {
  const at = ref.indexOf(SEPARATOR)
  const generationDurationSec = at < 0 ? Number.NaN : Number(ref.slice(0, at))
  const requestId = at < 0 ? '' : ref.slice(at + SEPARATOR.length)

  if (!Number.isFinite(generationDurationSec) || generationDurationSec <= 0 || requestId === '') {
    throw new ProviderError(
      `fal のジョブ参照を解釈できません（期待する形: <秒>${SEPARATOR}<request_id>）`,
      FAL_PROVIDER_ID,
      false,
    )
  }
  return { requestId, generationDurationSec }
}
