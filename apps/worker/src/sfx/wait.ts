import type { SfxJobId } from '@ixa/domain'
import { ProviderError, type ProviderJobHandle, type SfxJobStatusFromProvider, type SfxProvider } from '@ixa/provider-core'
import { SfxJobCancelled, SfxJobFailure, type SfxAdapter, type SfxProcessorDeps } from './deps.js'

/** 問い合わせが続けてこの回数だけ通信で失敗したら諦める（サーバの再起動 1 回で音を捨てない）。 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3
const DEFAULT_POLL_INTERVAL_MS = 1_000
/**
 * 生成先で順番を待つ上限。sfx-api は同じ機械の vpipe・klein・ace-step が空くまで走らない
 * （2026-10-18 の実測で 22 分待った）。その間を仕上がりの上限に数えると、作れる音を時間切れで捨てる。
 */
export const SFX_MAX_QUEUED_MS = 2 * 60 * 60 * 1000
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 生成先へ止めてと頼む。頼めなくてもログに残して進む（呼ぶ側はもう結果を使わない）。 */
export const stopRemoteSfx = async (
  deps: Pick<SfxProcessorDeps, 'logger'>,
  provider: SfxProvider,
  handle: ProviderJobHandle,
  sfxJobId: SfxJobId,
): Promise<void> => {
  await provider.cancel(handle).catch((error: unknown) => {
    deps.logger.warn({ sfxJobId, err: error }, '生成先へ止めてと頼めませんでした')
  })
}

/**
 * 出来上がりを待つ。**待っている間に止められたら、生成先へ止めてと頼んで手を引く。**
 * 諦めるときも生成先を止める（止めずに手を離すと、GPU の順番を返したあとで向こうが走り出す）。
 */
export const waitForSfx = async (
  deps: SfxProcessorDeps,
  adapter: SfxAdapter,
  handle: ProviderJobHandle,
  sfxJobId: SfxJobId,
): Promise<Extract<SfxJobStatusFromProvider, { state: 'succeeded' }>> => {
  const { provider } = adapter
  // 上限はモデルで桁が違う（Stable Audio は数秒、MOSS は数十分。descriptor の `maxWaitSec`）。
  const queuedDeadline = Date.now() + (deps.maxQueuedMs ?? SFX_MAX_QUEUED_MS)
  const maxRunMs = deps.maxWaitMs ?? adapter.model.maxWaitSec * 1000
  // 生成先で走り出してから数える。順番待ちの間は別の上限（queuedDeadline）だけを見る。
  let runDeadline: number | null = null
  let failures = 0
  for (;;) {
    const status = await provider.poll(handle).catch(async (error: unknown) => {
      failures += 1
      if (!(error instanceof ProviderError) || !error.retryable || failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        await stopRemoteSfx(deps, provider, handle, sfxJobId)
        throw error
      }
      deps.logger.warn({ sfxJobId, err: error, failures }, '出来上がりの問い合わせに失敗しました。少し待って聞き直します')
      return null
    })
    if (status !== null) failures = 0
    if (status?.state === 'succeeded') return status
    if (status?.state === 'failed') throw new SfxJobFailure(status.error)
    const current = await deps.sfxJobs.findById(sfxJobId)
    if (current?.status === 'cancelled') {
      await stopRemoteSfx(deps, provider, handle, sfxJobId)
      throw new SfxJobCancelled(sfxJobId)
    }
    if (status !== null && status.state !== 'pending' && runDeadline === null) runDeadline = Date.now() + maxRunMs
    if (Date.now() > (runDeadline ?? queuedDeadline)) {
      await stopRemoteSfx(deps, provider, handle, sfxJobId)
      throw new SfxJobFailure({ code: 'timeout', message: '効果音が時間内に仕上がりませんでした。', retryable: true })
    }
    await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  }
}
