import type { MusicJobId } from '@ixa/domain'
import {
  ProviderError,
  type MusicJobStatusFromProvider,
  type MusicModelDescriptor,
  type MusicProvider,
  type ProviderJobHandle,
} from '@ixa/provider-core'
import { MusicJobCancelled, MusicJobFailure, type MusicProcessorDeps } from './deps.js'

/** 問い合わせが続けてこの回数だけ通信で失敗したら諦める（サーバの再起動 1 回で曲を捨てない）。 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3
const DEFAULT_POLL_INTERVAL_MS = 3_000
/**
 * 投入してから仕上がるまでの上限（GPU の順番待ちは別に数える）。実測は 60 秒の曲 1 つで 33〜34 秒
 * （初回は読み込みで最大 93 秒）。240 秒の曲を 4 つ頼んでも十分に収まる長さを取る。
 */
export const MUSIC_MAX_WAIT_MS = 15 * 60 * 1000

/** モデルごとの待つ上限。とても遅いモデル（MiniMax-Music3）は自分の上限を持つ。 */
export const musicMaxWaitMs = (model: MusicModelDescriptor): number =>
  model.maxWaitSec === undefined ? MUSIC_MAX_WAIT_MS : model.maxWaitSec * 1000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 生成先へ止めてと頼む。頼めなくてもログに残して進む（呼ぶ側はもう結果を使わない）。 */
export const stopRemoteMusic = async (
  deps: Pick<MusicProcessorDeps, 'logger'>,
  provider: MusicProvider,
  handle: ProviderJobHandle,
  musicJobId: MusicJobId,
): Promise<void> => {
  await provider.cancel(handle).catch((error: unknown) => {
    deps.logger.warn({ musicJobId, err: error }, '生成先へ止めてと頼めませんでした')
  })
}

/**
 * 出来上がりを待つ。**待っている間に止められたら、生成先へ止めてと頼んで手を引く。**
 * 諦めるとき（時間切れ・問い合わせが続けて失敗）も生成先を止める。止めずに手を離すと、
 * 手元の GPU の順番を返したあとで向こうの生成が走り出し、次の動画と同時に GPU を使う（絵と同じ）。
 */
export const waitForMusic = async (
  deps: MusicProcessorDeps,
  provider: MusicProvider,
  handle: ProviderJobHandle,
  musicJobId: MusicJobId,
  maxWaitMs: number = MUSIC_MAX_WAIT_MS,
): Promise<Extract<MusicJobStatusFromProvider, { state: 'succeeded' }>> => {
  const deadline = Date.now() + (deps.maxWaitMs ?? maxWaitMs)
  let failures = 0
  for (;;) {
    const status = await provider.poll(handle).catch(async (error: unknown) => {
      failures += 1
      if (!(error instanceof ProviderError) || !error.retryable || failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        await stopRemoteMusic(deps, provider, handle, musicJobId)
        throw error
      }
      deps.logger.warn({ musicJobId, err: error, failures }, '出来上がりの問い合わせに失敗しました。少し待って聞き直します')
      return null
    })
    if (status !== null) failures = 0
    if (status?.state === 'succeeded') return status
    if (status?.state === 'failed') throw new MusicJobFailure(status.error)
    const current = await deps.musicJobs.findById(musicJobId)
    if (current?.status === 'cancelled') {
      await stopRemoteMusic(deps, provider, handle, musicJobId)
      throw new MusicJobCancelled(musicJobId)
    }
    if (Date.now() > deadline) {
      await stopRemoteMusic(deps, provider, handle, musicJobId)
      throw new MusicJobFailure({ code: 'timeout', message: '曲が時間内に仕上がりませんでした。', retryable: true })
    }
    await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  }
}
