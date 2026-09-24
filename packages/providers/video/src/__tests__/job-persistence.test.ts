import { randomUUID } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProviderError, type ProviderJobHandle } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stubVeoLikeModel } from '../stub/descriptor.js'
import { readStubJob, writeStubJob } from '../stub/job-store.js'
import { createStubVideoProvider } from '../stub/provider.js'
import {
  createTempDir,
  makeRequest,
  makeSpec,
  pollUntilSettled,
  pollUntilSucceeded,
  removeTempDir,
} from './fixtures.js'

/**
 * スタブのジョブ状態はディスクに置く（`stub/job-store.ts`）。
 *
 * **これが無いと、投入済みの生成が「記録が見つからない」で終端失敗する。**
 * worker が 2 プロセス動いていたとき、8 件生成して 7 件がこれで落ちた。
 * 投入した instance と問い合わせる instance が違う、という形をここで検査する。
 */

const TEST_TIMEOUT_MS = 180_000

const handleFor = (ref: string): ProviderJobHandle => ({
  providerId: stubVeoLikeModel.providerId,
  modelId: stubVeoLikeModel.id,
  ref,
  submittedAt: new Date(),
})

/** 失敗を値として受け取る。成功してしまったらテストを落とす。 */
const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('失敗するはずの呼び出しが成功しました')
}

/** 例外の連鎖を 1 本の文字列に畳む。参照がログ側へ残っていることを見るために使う。 */
const causeChain = (error: unknown): string => {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    parts.push(current.message)
    current = current.cause
  }
  return parts.join(' / ')
}

describe('スタブのジョブ状態はプロセスを跨いで読める', () => {
  let outputDir = ''

  beforeEach(async () => {
    outputDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(outputDir)
  })

  it(
    '別の instance で poll しても、投入済みの生成を追いかけて結果まで読める',
    async () => {
      const submitter = createStubVideoProvider({ outputDir })
      const handle = await submitter.submit(makeRequest(stubVeoLikeModel, makeSpec()))

      // 同じ outputDir を指す別の instance。worker が 2 プロセス動いている状況と同じ。
      const watcher = createStubVideoProvider({ outputDir })

      // 投入した直後から記録がある。ここが空だと、走っている生成が即座に捨てられる。
      expect(['pending', 'running']).toContain((await watcher.poll(handle)).state)

      const expected = await pollUntilSucceeded(submitter, handle)
      const seen = await watcher.poll(handle)

      expect(seen.state).toBe('succeeded')
      if (seen.state !== 'succeeded') return
      expect(seen.output).toEqual(expected.output)
      expect(seen.seedUsed).toBe(expected.seedUsed)
      expect(seen.costUsd).toBe(expected.costUsd)
      expect(seen.raw).toEqual(expected.raw)
    },
    TEST_TIMEOUT_MS,
  )

  it('別の instance からは失敗の理由も読める', async () => {
    const submitter = createStubVideoProvider({ outputDir, failureRate: 1 })
    const handle = await submitter.submit(makeRequest(stubVeoLikeModel, makeSpec()))
    await pollUntilSettled(submitter, handle)

    const status = await createStubVideoProvider({ outputDir }).poll(handle)
    expect(status.state).toBe('failed')
    if (status.state !== 'failed') return
    expect(status.error.code).toBe('stub_injected_failure')
    expect(status.error.retryable).toBe(true)
  })

  it('取り消しは、走らせていない instance からでも記録に残る', async () => {
    const ref = randomUUID()
    await writeStubJob(outputDir, {
      ref,
      status: { state: 'pending', progress: null },
      cancelled: false,
    })

    await createStubVideoProvider({ outputDir }).cancel(handleFor(ref))

    const stored = await readStubJob(outputDir, ref)
    expect(stored.kind).toBe('found')
    if (stored.kind !== 'found') return
    expect(stored.job.cancelled).toBe(true)
    expect(stored.job.status.state).toBe('failed')
  })

  it('書き込みは置き換えだけを残す（途中の一時ファイルを残さない）', async () => {
    const ref = randomUUID()
    const job = { ref, status: { state: 'pending', progress: null }, cancelled: false } as const
    await writeStubJob(outputDir, job)
    await writeStubJob(outputDir, { ...job, status: { state: 'running', progress: null } })

    expect(await readdir(outputDir)).toEqual([`${ref}.json`])
    const stored = await readStubJob(outputDir, ref)
    expect(stored.kind === 'found' && stored.job.status.state).toBe('running')
  })
})

describe('読めない記録は「無い」と同じに扱う', () => {
  let outputDir = ''

  beforeEach(async () => {
    outputDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(outputDir)
  })

  it('記録が無いジョブを poll すると失敗する', async () => {
    const error = await rejectionOf(
      createStubVideoProvider({ outputDir }).poll(handleFor(randomUUID())),
    )
    expect(error).toBeInstanceOf(ProviderError)
    expect(error instanceof ProviderError && error.retryable).toBe(false)
  })

  /** 途中まで書かれた JSON。中身を推測して状態を作らない。 */
  it('記録が壊れていたら poll は失敗する', async () => {
    const ref = randomUUID()
    await writeFile(join(outputDir, `${ref}.json`), '{"ref":"', 'utf8')

    const error = await rejectionOf(createStubVideoProvider({ outputDir }).poll(handleFor(ref)))
    expect(error).toBeInstanceOf(ProviderError)
    // 読めなかった理由を捨てない。捨てると壊れた記録を延々と探すことになる。
    expect(causeChain(error)).toContain(ref)
  })

  /**
   * JSON としては読めるが、状態の形が違うもの。
   * zod を外すとこれが素通りし、`state: 'done'` のまま画面まで流れる。
   */
  it('記録の形が違えば poll は失敗する', async () => {
    const ref = randomUUID()
    await writeFile(
      join(outputDir, `${ref}.json`),
      JSON.stringify({ ref, cancelled: false, status: { state: 'done' } }),
      'utf8',
    )

    const error = await rejectionOf(createStubVideoProvider({ outputDir }).poll(handleFor(ref)))
    expect(error).toBeInstanceOf(ProviderError)
  })

  it('succeeded の中身が欠けている記録も受け付けない', async () => {
    const ref = randomUUID()
    await writeFile(
      join(outputDir, `${ref}.json`),
      JSON.stringify({ ref, cancelled: false, status: { state: 'succeeded', costUsd: 0 } }),
      'utf8',
    )

    expect((await readStubJob(outputDir, ref)).kind).toBe('unreadable')
  })

  /** 参照は DB を経由して戻ってくる。そのまま `join` すると外を指せてしまう。 */
  it('ジョブ参照の形をしていないものはファイルとして読みに行かない', async () => {
    expect((await readStubJob(outputDir, '../../etc/passwd')).kind).toBe('missing')
    expect((await readStubJob(outputDir, 'does-not-exist')).kind).toBe('missing')
    await expect(
      writeStubJob(outputDir, {
        ref: '../escape',
        status: { state: 'pending', progress: null },
        cancelled: false,
      }),
    ).rejects.toThrow('ジョブ参照の形')
  })
})

describe('記録が見つからないときの文面', () => {
  let outputDir = ''

  beforeEach(async () => {
    outputDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(outputDir)
  })

  /**
   * この文はそのまま画面の通知になる（worker → `generation_job.status` → 上部の通知）。
   * CLAUDE.md の「画面に出さない: 内部 ID・実装の名前」がここに掛かる。
   */
  it('利用者に見せる文へ内部の参照や実装の言葉を入れない', async () => {
    const ref = randomUUID()
    const error = await rejectionOf(createStubVideoProvider({ outputDir }).poll(handleFor(ref)))
    expect(error).toBeInstanceOf(ProviderError)
    if (!(error instanceof ProviderError)) return

    expect(error.message).not.toContain(ref)
    expect(error.message).not.toMatch(/ジョブ|poll|provider|json|uuid/i)
    // 起きたことと、次にどうすればいいかを言う。
    expect(error.message).toContain('記録が見つかりません')
    expect(error.message).toContain('もう一度生成してください')
  })

  /** 参照そのものはログのために残す。消してしまうと、どの生成の話か追えなくなる。 */
  it('参照は例外の連鎖に残してログから追えるようにする', async () => {
    const ref = randomUUID()
    const error = await rejectionOf(createStubVideoProvider({ outputDir }).poll(handleFor(ref)))
    expect(causeChain(error)).toContain(ref)
  })
})
