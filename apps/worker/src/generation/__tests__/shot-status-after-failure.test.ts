import type { GenerationJobId, GenerationJobStatus } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { shotStatusAfterFailure } from '../shot-status-after-failure.js'

/**
 * 生成が失敗したときに Shot を生成中から解放する判断。
 *
 * ここが `null` を返し続けると、Shot は DB ごと `generating` で固まり、
 * 画面の生成ボタンが二度と押せなくなる（本番で起きていた症状）。
 */

const jobId = (value: string): GenerationJobId => value as GenerationJobId

const FAILED = jobId('job-failed')

const job = (id: string, status: GenerationJobStatus) => ({ id: jobId(id), status })

describe('shotStatusAfterFailure', () => {
  it('ほかのジョブが走っていれば、まだ動かさない', () => {
    const next = shotStatusAfterFailure({
      jobs: [job('job-failed', 'failed'), job('job-b', 'running')],
      failedJobId: FAILED,
      hasTakes: false,
      hasSelectedTake: false,
    })

    expect(next).toBeNull()
  })

  it('順番待ちのジョブが残っていても、まだ動かさない', () => {
    const next = shotStatusAfterFailure({
      jobs: [job('job-failed', 'failed'), job('job-b', 'queued')],
      failedJobId: FAILED,
      hasTakes: false,
      hasSelectedTake: false,
    })

    expect(next).toBeNull()
  })

  it('残りが無く Take も無いなら要判断にする（生成中のままにしない）', () => {
    const next = shotStatusAfterFailure({
      jobs: [job('job-failed', 'failed')],
      failedJobId: FAILED,
      hasTakes: false,
      hasSelectedTake: false,
    })

    expect(next).toBe('blocked')
  })

  it('要判断であって生成可能ではない。失敗の痕跡を消さない', () => {
    const next = shotStatusAfterFailure({
      jobs: [job('job-failed', 'failed')],
      failedJobId: FAILED,
      hasTakes: false,
      hasSelectedTake: false,
    })

    // `ready` に戻すと一覧から失敗に気づけなくなる。
    expect(next).not.toBe('ready')
    expect(next).not.toBe('generating')
  })

  it('残りが無く Take があるなら採用待ちにする', () => {
    const next = shotStatusAfterFailure({
      jobs: [job('job-failed', 'failed'), job('job-b', 'succeeded')],
      failedJobId: FAILED,
      hasTakes: true,
      hasSelectedTake: false,
    })

    expect(next).toBe('review')
  })

  it('自分自身がまだ queued に見えても、それで止まらない', () => {
    // 行の更新と findByShot の順序によっては、失敗したジョブが古い状態で返る。
    const next = shotStatusAfterFailure({
      jobs: [job('job-failed', 'queued')],
      failedJobId: FAILED,
      hasTakes: false,
      hasSelectedTake: false,
    })

    expect(next).toBe('blocked')
  })

  it('終わったジョブだけが残っていても止まらない', () => {
    const next = shotStatusAfterFailure({
      jobs: [
        job('job-failed', 'failed'),
        job('job-b', 'cancelled'),
        job('job-c', 'succeeded'),
      ],
      failedJobId: FAILED,
      hasTakes: true,
      hasSelectedTake: false,
    })

    expect(next).toBe('review')
  })

  /**
   * **採用している Take があれば、作り直しに失敗しても採用済みのまま**（ADR-0023）。
   * 以前は Take があれば一律 `review` に戻していたので、採用済みの Shot で
   * 作り直しを試して失敗しただけで「採用待ち」に落ちた。
   */
  it('採用している Take があれば採用済みのまま', () => {
    const next = shotStatusAfterFailure({
      jobs: [job('job-failed', 'failed')],
      failedJobId: FAILED,
      hasTakes: true,
      hasSelectedTake: true,
    })

    expect(next).toBe('approved')
  })
})
