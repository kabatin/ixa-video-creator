import type { GenerationJobId } from '@ixa/domain'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'

/**
 * この機械の GPU（Metal）を 1 本ずつに揃える（ADR-0040）。
 *
 * 手元の生成サーバは 2 台ある（vpipe-api の MiniMax H3・wan-api の Wan 2.2）。**サーバ同士は
 * 互いを知らない**ので、それぞれは「自分は 1 本ずつ」しか守れない。両方を有効にすると、
 * 32GB の Unified Memory を 2 本が取り合い、スワップで両方が大きく遅くなる（最悪は Metal の OOM）。
 * 止められるのは投入する側（worker）だけなので、ここで順番を作る。
 *
 * 形は**期限付きの借り**（lease）にする。
 * - 置き場は Redis（キューと同じ。worker が複数プロセスでも 1 つの約束になる）。
 *   プロセスの中のミューテックスでは、worker を 2 つ立てた時点で効かなくなる
 * - **期限を切る。** worker が落ちたまま返されない借りで永久に止まらないため。生きている間は
 *   問い合わせのたびに延ばす（`renew`）
 * - 借りられなかったことは**失敗ではない**。呼ぶ側は既存の「生成先が混んでいる」経路に乗せ、
 *   ジョブを queued のまま置いて後でやり直す（`ProviderBusyError`。ADR-0031）
 *
 * **雲の上の Provider（fal）は借りない。** 借りるのは `exclusiveResource: 'local-gpu'` を
 * 名乗る Provider のジョブだけで、ローカルの生成が走っている間もクラウドの生成は進む。
 */

/** Redis のキー。1 つだけ（この機械の GPU は 1 つ）。 */
export const LOCAL_GPU_LEASE_KEY = 'ixa:local-video-gpu'

/**
 * 借りの期限。**問い合わせの間隔（手元のサーバは 30 秒おき）より十分長く取る。**
 *
 * 長すぎると、worker が落ちたときに次の生成が始まるまで黙って待たされる。
 * 短すぎると、問い合わせが数回つまずいただけで借りが切れ、2 本が同時に走る。
 * 30 秒おきの問い合わせを 10 回落としてもまだ保つ長さにしてある。
 */
export const LOCAL_GPU_LEASE_TTL_MS = 5 * 60 * 1000

/** 借りられなかったときに、次に試すまでの目安（worker が 30 秒〜10 分に収めて使う）。 */
export const LOCAL_GPU_RETRY_AFTER_MS = 60_000

export type LocalGpuLeaseResult =
  | { readonly state: 'acquired' }
  /** ほかのジョブが借りている。`by` はそのジョブの ID（記録と画面の文のため）。 */
  | { readonly state: 'held'; readonly by: string }

export type LocalGpuLease = {
  /**
   * 借りる。空いていれば借りられ、**同じジョブが既に借りていれば期限を延ばして借りたことにする**
   * （冪等。投入をやり直したときに自分の借りで自分が待たされない）。
   */
  acquire(jobId: GenerationJobId): Promise<LocalGpuLeaseResult>
  /** 期限を延ばす。借りが切れていれば borrow し直す（切れたまま走り続けるより良い）。 */
  renew(jobId: GenerationJobId): Promise<LocalGpuLeaseResult>
  /** 返す。**自分の借りでなければ何もしない**（ほかのジョブの借りを奪わない）。 */
  release(jobId: GenerationJobId): Promise<void>
}

/**
 * 空いていれば借り、自分の借りなら期限だけ延ばす。**借りている相手が居ればその ID を返す。**
 * 1 回の呼び出しで読んで書くので、2 つの worker が同時に来ても両方が借りたことにならない。
 */
const ACQUIRE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 'ok'
end
return current
`

/** 自分の借りだけ返す。 */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export type RedisLocalGpuLeaseOptions = {
  readonly connection: Redis
  readonly key?: string
  readonly ttlMs?: number
}

export const createRedisLocalGpuLease = (options: RedisLocalGpuLeaseOptions): LocalGpuLease => {
  const key = options.key ?? LOCAL_GPU_LEASE_KEY
  const ttlMs = options.ttlMs ?? LOCAL_GPU_LEASE_TTL_MS

  const take = async (jobId: GenerationJobId): Promise<LocalGpuLeaseResult> => {
    const result: unknown = await options.connection.eval(
      ACQUIRE_SCRIPT,
      1,
      key,
      jobId,
      String(ttlMs),
    )
    if (result === 'ok') return { state: 'acquired' }
    // 文字列以外（想定外）は「誰かが借りている」に倒す。GPU を 2 本で取り合わせない。
    return { state: 'held', by: typeof result === 'string' ? result : 'unknown' }
  }

  return {
    acquire: take,
    renew: take,
    release: async (jobId) => {
      await options.connection.eval(RELEASE_SCRIPT, 1, key, jobId)
    },
  }
}

/**
 * **配線されていないときの代わり。**（`createUnwiredEventPublisher` と同じ考え方）
 *
 * 必ず借りられたと答えるが、**順番を作っていないことをログに残す。** 黙って通すと
 * 「GPU を 1 本ずつにしたつもりが、両方同時に走っていた」に気付けない。
 */
export const createUnprotectedLocalGpuLease = (logger: Logger): LocalGpuLease => {
  const warn = (jobId: GenerationJobId): void => {
    logger.warn(
      { jobId },
      'この機械の GPU の順番を作る口が配線されていません。ローカルの生成が同時に走る可能性があります',
    )
  }
  return {
    acquire: (jobId) => {
      warn(jobId)
      return Promise.resolve({ state: 'acquired' })
    },
    renew: () => Promise.resolve({ state: 'acquired' }),
    release: () => Promise.resolve(),
  }
}

/**
 * **テスト用。** 1 つのプロセスの中でだけ効く借り。
 * 本番では使わない（worker を 2 つ立てた時点で約束が成り立たない）。
 */
export const createInMemoryLocalGpuLease = (): LocalGpuLease => {
  let holder: string | null = null
  return {
    acquire: (jobId) => {
      if (holder === null || holder === jobId) {
        holder = jobId
        return Promise.resolve({ state: 'acquired' })
      }
      return Promise.resolve({ state: 'held', by: holder })
    },
    renew: (jobId) => {
      if (holder === null || holder === jobId) {
        holder = jobId
        return Promise.resolve({ state: 'acquired' })
      }
      return Promise.resolve({ state: 'held', by: holder })
    },
    release: (jobId) => {
      if (holder === jobId) holder = null
      return Promise.resolve()
    },
  }
}
