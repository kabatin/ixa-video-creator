import type { GenerationJobId } from '@ixa/domain'
import Redis from 'ioredis'
import { createLogger } from '../../logger.js'
import { createRedisLocalGpuLease, LOCAL_GPU_LINE_STALE_MS } from '../local-gpu-lease.js'

/**
 * 整理券（`local-gpu-lease.ts` の Lua）を**実物の Redis で**確かめる。
 *
 * **CI では回らない。** CI に Redis が無いため（`.github/workflows/ci.yml` に services が無い）。
 * vitest が見ているのは同じ決まりのメモリ版（`createInMemoryLocalGpuLease`）で、
 * **本番で動く Lua はここでしか確かめられない**。順番の決まりを触ったら手で回すこと。
 *
 *     pnpm --filter @ixa/worker check:gpu-line
 *
 * 使うのは `ixa:test:` で始まる鍵だけで、動いている生成の列には触らない。
 */

const jobId = (value: string): GenerationJobId => value as GenerationJobId

/** 先に積んだ A、後から積んだ B、場所を塞ぐ C。 */
const EARLIER = jobId('01AAAAAAAAAAAAAAAAAAAAAAAA')
const LATER = jobId('01BBBBBBBBBBBBBBBBBBBBBBBB')
const HOLDER = jobId('01CCCCCCCCCCCCCCCCCCCCCCCC')

const KEY = 'ixa:test:local-video-gpu'
const EARLY_TICKET = 1_000
const LATE_TICKET = 2_000

const main = async (): Promise<void> => {
  const logger = createLogger('info')
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')
  let nowMs = 1_700_000_000_000
  const lease = createRedisLocalGpuLease({ connection, key: KEY, now: () => new Date(nowMs) })
  const reset = (): Promise<unknown> => connection.del(KEY, `${KEY}:line`, `${KEY}:seen`)

  let failed = 0
  const check = (label: string, passed: boolean, got: unknown): void => {
    if (passed) logger.info({ check: label }, '合格')
    else {
      failed += 1
      logger.error({ check: label, got }, '不合格')
    }
  }

  // 後から積んだほうが先に頼んでも、先に積んだほうが取る（この直しの肝）
  await reset()
  await lease.acquire(HOLDER, 0)
  await lease.acquire(LATER, LATE_TICKET)
  await lease.acquire(EARLIER, EARLY_TICKET)
  await lease.release(HOLDER)
  const laterTurn = await lease.acquire(LATER, LATE_TICKET)
  const earlierTurn = await lease.acquire(EARLIER, EARLY_TICKET)
  check(
    '後から積んだほうは待ち、先に積んだほうが取る',
    laterTurn.state === 'waiting' && earlierTurn.state === 'acquired',
    { laterTurn, earlierTurn },
  )

  // 同じミリ秒に積んだ分は jobId の順（ULID なので積んだ順）
  await reset()
  await lease.acquire(HOLDER, 0)
  await lease.acquire(LATER, 500)
  await lease.acquire(EARLIER, 500)
  await lease.release(HOLDER)
  const sameLater = await lease.acquire(LATER, 500)
  const sameEarlier = await lease.acquire(EARLIER, 500)
  check('券の番号が同じなら jobId の小さいほうが先', sameLater.state === 'waiting' && sameEarlier.state === 'acquired', {
    sameLater,
    sameEarlier,
  })

  // 顔を出さなくなった券は捨てる（死んだ券で列を止めない）
  await reset()
  await lease.acquire(HOLDER, 0)
  await lease.acquire(EARLIER, EARLY_TICKET)
  await lease.acquire(LATER, LATE_TICKET)
  await lease.release(HOLDER)
  const blocked = await lease.acquire(LATER, LATE_TICKET)
  nowMs += LOCAL_GPU_LINE_STALE_MS + 1
  const freed = await lease.acquire(LATER, LATE_TICKET)
  check('顔を出さない券は捨てて列を進める', blocked.state === 'waiting' && freed.state === 'acquired', { blocked, freed })

  // 券の番号は呼び直しても動かない（待つほど後ろへ送られない）
  await reset()
  await lease.acquire(HOLDER, 0)
  await lease.acquire(EARLIER, EARLY_TICKET)
  nowMs += 60_000
  await lease.acquire(LATER, LATE_TICKET)
  nowMs += 60_000
  await lease.acquire(EARLIER, EARLY_TICKET)
  await lease.release(HOLDER)
  const keptLater = await lease.acquire(LATER, LATE_TICKET)
  const keptEarlier = await lease.acquire(EARLIER, EARLY_TICKET)
  check('券の番号は呼び直しても動かない', keptLater.state === 'waiting' && keptEarlier.state === 'acquired', {
    keptLater,
    keptEarlier,
  })

  // 諦めたジョブの券は列に残らない
  await reset()
  await lease.acquire(HOLDER, 0)
  await lease.acquire(EARLIER, EARLY_TICKET)
  await lease.release(EARLIER)
  await lease.release(HOLDER)
  const afterGiveUp = await lease.acquire(LATER, LATE_TICKET)
  check('諦めたジョブの券は列に残らない', afterGiveUp.state === 'acquired', afterGiveUp)

  await reset()
  await connection.quit()
  if (failed > 0) {
    logger.error({ failed }, '整理券の検査に落ちた項目があります')
    process.exitCode = 1
  }
}

void main()
