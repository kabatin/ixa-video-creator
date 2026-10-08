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
 *
 * ## 整理券（2026-10-08）
 *
 * 借りるだけでは**早い者勝ち**になる。空いた瞬間に起きていたジョブが取るので、
 * 列が長い作品が勝ち続け、もう片方は進まない。実際に 2 作品を積んだ夜、
 * 先に積んだほうが **5 時間 1 本も進まなかった**（もう片方は 1 時間に 9〜10 本）。
 *
 * そこで**積んだ順に渡す**。番号は `queuedAt`（ミリ秒）で、空いていても
 * **自分より小さい番号が待っていれば取らない**。
 *
 * - 列は Redis の ZSET。同点（同じミリ秒に積んだ分）はメンバー名で割れ、
 *   **jobId は ULID なので時系列**に並ぶ。並びは何度見ても同じ
 * - **生存印**を別の ZSET に持ち、呼ばれるたび今の時刻で押し直す。
 *   worker が落ちたジョブの券は押されなくなり、`LINE_STALE_MS` を過ぎたら捨てる。
 *   捨てないと、死んだ券が先頭に居座って列が永久に止まる
 * - 列は**実行の順番を決めるためだけ**のもの。DB には何も書かない（ADR-0008 の
 *   「DB が真実、キューは実行手段」のうち、これは実行手段の側）
 *
 * **CI はこの Lua を見ていない**（CI に Redis が無い）。vitest が確かめているのは
 * 同じ決まりを別に書いたメモリ版（`createInMemoryLocalGpuLease`）なので、**2 つはズレうる**。
 * 順番の決まりを触ったら、実物の Redis で必ず回すこと:
 *
 *     pnpm --filter @ixa/worker check:gpu-line
 */

/** Redis のキー。1 つだけ（この機械の GPU は 1 つ）。 */
export const LOCAL_GPU_LEASE_KEY = 'ixa:local-video-gpu'

/** 整理券の列（ZSET。score = 積んだ時刻のミリ秒）。 */
export const LOCAL_GPU_LINE_KEY = `${LOCAL_GPU_LEASE_KEY}:line`
/** 券の生存印（ZSET。score = 最後に顔を出した時刻のミリ秒）。 */
export const LOCAL_GPU_LINE_SEEN_KEY = `${LOCAL_GPU_LEASE_KEY}:seen`

/**
 * これだけ顔を出さない券は捨てる。
 *
 * 待っているジョブは最長でも `SUBMIT_BUSY_MAX_DELAY_MS`（10 分）ごとに必ず顔を出すので、
 * それより長く取る。短いと、長く眠ったジョブの券が消えて列の後ろに回される。
 */
export const LOCAL_GPU_LINE_STALE_MS = 15 * 60 * 1000

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

/**
 * **自分が先頭のとき**に、次に試すまでの目安。
 *
 * 整理券にすると、取れるのは先頭だけになる。先頭が長く寝ていると、その間 GPU が空いたまま遊ぶ
 * （1 本 4〜5 分に対して 60 秒の空きは 2 割の損）。先頭だけ短く起こす。
 * 先頭以外が頻繁に叩いても取れないので、そちらは従来どおり。
 *
 * **`SUBMIT_BUSY_MIN_DELAY_MS`（30 秒）より短い。** 下限は worker 側で丸められるため、
 * ここだけ短くしても効かない。`busy.ts` の `submitBusyDelayMs` が先頭を別扱いする。
 */
export const LOCAL_GPU_HEAD_RETRY_AFTER_MS = 10_000

export type LocalGpuLeaseResult =
  | { readonly state: 'acquired' }
  /**
   * ほかのジョブが借りている。`by` はそのジョブの ID（記録と画面の文のため）。
   * `ahead` は**自分の前に並んでいる券の数**。0 なら次は自分の番（待つのは走っている 1 本だけ）。
   */
  | { readonly state: 'held'; readonly by: string; readonly ahead: number }
  /**
   * 空いているが、**自分より先に積まれた券が `ahead` 枚**ある。順番が来るまで取らない。
   * `held` と分けるのは、画面とログで「混んでいる」と「自分の番ではない」を言い分けるため。
   */
  | { readonly state: 'waiting'; readonly ahead: number }

/** 整理券の番号。**積んだ時刻（ミリ秒）**。小さいほど先。 */
export type LocalGpuTicket = number

export type LocalGpuLease = {
  /**
   * 列に並び、順番が来ていれば借りる。
   *
   * - 空いていて**自分が先頭**なら借りる（`acquired`）。同じジョブが既に借りていれば期限を延ばす
   *   （冪等。投入をやり直したときに自分の借りで自分が待たされない）
   * - ほかが走っていれば `held`、空いていても自分の番でなければ `waiting`
   * - 券の番号は**最初に並んだときのものを動かさない**。呼ぶたびに今の時刻で付け直すと、
   *   待っているジョブが永遠に後ろへ送られる
   */
  acquire(jobId: GenerationJobId, ticket: LocalGpuTicket): Promise<LocalGpuLeaseResult>
  /** 期限を延ばす。借りが切れていれば borrow し直す（切れたまま走り続けるより良い）。 */
  renew(jobId: GenerationJobId): Promise<LocalGpuLeaseResult>
  /** 返す。**自分の借りでなければ何もしない**（ほかのジョブの借りを奪わない）。券は必ず列から外す。 */
  release(jobId: GenerationJobId): Promise<void>
}

/**
 * 空いていれば借り、自分の借りなら期限だけ延ばす。**借りている相手が居ればその ID を返す。**
 * 1 回の呼び出しで読んで書くので、2 つの worker が同時に来ても両方が借りたことにならない。
 */
const ACQUIRE_SCRIPT = `
local lease = KEYS[1]
local line = KEYS[2]
local seen = KEYS[3]
local jobId = ARGV[1]
local ttlMs = ARGV[2]
local ticket = ARGV[3]
local nowMs = tonumber(ARGV[4])
local staleMs = tonumber(ARGV[5])

-- 自分の借りなら、列を見るまでもなく期限だけ延ばす（投入のやり直しで自分が自分を待たない）
local current = redis.call('GET', lease)
if current == jobId then
  redis.call('SET', lease, jobId, 'PX', ttlMs)
  redis.call('ZREM', line, jobId)
  redis.call('ZREM', seen, jobId)
  return {'ok', '', 0}
end

-- 並ぶ。**番号は最初の 1 回だけ**（NX）。顔を出した印は毎回押し直す
redis.call('ZADD', line, 'NX', ticket, jobId)
redis.call('ZADD', seen, nowMs, jobId)

-- 顔を出さなくなった券を捨てる。残すと死んだ券が先頭に居座って列が止まる
local dead = redis.call('ZRANGEBYSCORE', seen, '-inf', nowMs - staleMs)
for i = 1, #dead do
  redis.call('ZREM', line, dead[i])
  redis.call('ZREM', seen, dead[i])
end

-- 自分より前に何枚あるか。**番号が同じなら jobId の小さいほうが先**（ULID なので積んだ順）
local myTicket = tonumber(redis.call('ZSCORE', line, jobId))
local ahead = redis.call('ZCOUNT', line, '-inf', '(' .. myTicket)
local sameTicket = redis.call('ZRANGEBYSCORE', line, myTicket, myTicket)
for i = 1, #sameTicket do
  if sameTicket[i] < jobId then
    ahead = ahead + 1
  end
end

if current ~= false then
  return {'held', current, ahead}
end

if ahead == 0 then
  redis.call('SET', lease, jobId, 'PX', ttlMs)
  redis.call('ZREM', line, jobId)
  redis.call('ZREM', seen, jobId)
  return {'ok', '', 0}
end

return {'waiting', '', ahead}
`

/** 自分の借りだけ返す。**券は必ず外す**（取れないまま終わったジョブの券を残さない）。 */
const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export type RedisLocalGpuLeaseOptions = {
  readonly connection: Redis
  readonly key?: string
  readonly ttlMs?: number
  readonly staleMs?: number
  /** いまの時刻（試験で差し替える）。 */
  readonly now?: () => Date
}

/**
 * Lua の答えを読む。`ok` / `held:<jobId>` / `waiting:<件数>`。
 *
 * **知らない答えは「誰かが借りている」に倒す。** 取れたことにすると GPU を 2 本で取り合う。
 */
const readLeaseReply = (reply: unknown): LocalGpuLeaseResult => {
  if (!Array.isArray(reply)) return { state: 'held', by: 'unknown', ahead: 0 }
  const [state, by, ahead] = reply as readonly unknown[]
  const count = typeof ahead === 'number' && Number.isFinite(ahead) ? ahead : 0
  if (state === 'ok') return { state: 'acquired' }
  if (state === 'waiting') return { state: 'waiting', ahead: count }
  return { state: 'held', by: typeof by === 'string' && by !== '' ? by : 'unknown', ahead: count }
}

export const createRedisLocalGpuLease = (options: RedisLocalGpuLeaseOptions): LocalGpuLease => {
  const key = options.key ?? LOCAL_GPU_LEASE_KEY
  const lineKey = `${key}:line`
  const seenKey = `${key}:seen`
  const ttlMs = options.ttlMs ?? LOCAL_GPU_LEASE_TTL_MS
  const staleMs = options.staleMs ?? LOCAL_GPU_LINE_STALE_MS
  const now = options.now ?? ((): Date => new Date())

  const take = async (
    jobId: GenerationJobId,
    ticket: LocalGpuTicket,
  ): Promise<LocalGpuLeaseResult> =>
    readLeaseReply(
      await options.connection.eval(
        ACQUIRE_SCRIPT,
        3,
        key,
        lineKey,
        seenKey,
        jobId,
        String(ttlMs),
        String(ticket),
        String(now().getTime()),
        String(staleMs),
      ),
    )

  return {
    acquire: take,
    /**
     * 期限の延長。**借りている本人しか呼ばない**ので、券の番号は要らない
     * （Lua の最初の枝で「自分の借り」として通る）。列に並び直させないため 0 を渡す。
     */
    renew: (jobId) => take(jobId, 0),
    release: async (jobId) => {
      await options.connection.eval(RELEASE_SCRIPT, 3, key, lineKey, seenKey, jobId)
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
 *
 * **順番の決まりは Redis 版と同じ**にする（積んだ順。同点は jobId 順）。
 * ここだけ早い者勝ちにすると、試験が通るのに本番で飢えが起きる。
 */
export const createInMemoryLocalGpuLease = (options: { readonly now?: () => Date } = {}): LocalGpuLease => {
  const now = options.now ?? ((): Date => new Date())
  let holder: string | null = null
  /** 並んでいる券。jobId → 番号と、最後に顔を出した時刻。 */
  const line = new Map<string, { readonly ticket: LocalGpuTicket; seenAtMs: number }>()

  const leave = (jobId: string): void => {
    line.delete(jobId)
  }

  const take = (jobId: GenerationJobId, ticket: LocalGpuTicket): Promise<LocalGpuLeaseResult> => {
    if (holder === jobId) {
      leave(jobId)
      return Promise.resolve({ state: 'acquired' })
    }

    const nowMs = now().getTime()
    const mine = line.get(jobId)
    // 番号は最初の 1 回だけ。顔を出した印は毎回押し直す
    line.set(jobId, { ticket: mine?.ticket ?? ticket, seenAtMs: nowMs })
    for (const [id, entry] of [...line]) {
      if (nowMs - entry.seenAtMs >= LOCAL_GPU_LINE_STALE_MS) line.delete(id)
    }

    // 自分より前の券の数。**番号が同じなら jobId の小さいほうが先**（Redis 版と同じ決まり）
    const myTicket = line.get(jobId)?.ticket ?? ticket
    const ahead = [...line].filter(
      ([id, entry]) => entry.ticket < myTicket || (entry.ticket === myTicket && id < jobId),
    ).length

    if (holder !== null) return Promise.resolve({ state: 'held', by: holder, ahead })
    if (ahead > 0) return Promise.resolve({ state: 'waiting', ahead })

    holder = jobId
    leave(jobId)
    return Promise.resolve({ state: 'acquired' })
  }

  return {
    acquire: take,
    renew: (jobId) => take(jobId, 0),
    release: (jobId) => {
      leave(jobId)
      if (holder === jobId) holder = null
      return Promise.resolve()
    },
  }
}
