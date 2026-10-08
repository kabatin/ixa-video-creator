import { describe, expect, it } from 'vitest'
import { ProjectId, ShotId, TakeId, UpscaleJobId, newId } from '@ixa/domain'
import type { UpscaleJobRow } from '../repositories/upscale-job-repository.js'
import { upscaleJobRowToDomain } from '../repositories/upscale-job-repository.js'

/**
 * 実 DB には接続しない。row → Domain の変換だけを確かめる（`generation-job-repository` と同じ形）。
 *
 * 見たいのは **元の Take（source_take_id）と見込み（estimate_seconds）が行から読めること**。
 * 元の Take が落ちると「何から作ったか」が消え、見込みが落ちると画面が黙って
 * こちら側の概算に戻る（サーバの実測より粗い値に、気づかないまま置き換わる）。
 */

const baseRow = (): UpscaleJobRow => ({
  id: newId(UpscaleJobId),
  projectId: newId(ProjectId),
  shotId: newId(ShotId),
  sourceTakeId: newId(TakeId),
  status: 'queued',
  providerId: 'vpipe',
  modelId: 'vpipe/flashvsr-upscale',
  takeId: null,
  error: null,
  estimateSeconds: null,
  providerRecord: null,
  queuedAt: new Date('2026-10-09T00:00:00.000Z'),
  startedAt: null,
  finishedAt: null,
})

describe('upscaleJobRowToDomain', () => {
  it('元の Take を行から読む', () => {
    const row = baseRow()
    expect(upscaleJobRowToDomain(row).sourceTakeId).toBe(row.sourceTakeId)
  })

  /** 走っている間の「あと何分」はこの値が正。落ちるとこちら側の概算に黙って戻る。 */
  it('見込みの秒数を行から読む', () => {
    const row = { ...baseRow(), status: 'running' as const, estimateSeconds: 409 }
    expect(upscaleJobRowToDomain(row).estimateSeconds).toBe(409)
  })

  it('出来上がった Take を行から読む', () => {
    const takeId = newId(TakeId)
    const row = { ...baseRow(), status: 'succeeded' as const, takeId }
    expect(upscaleJobRowToDomain(row).takeId).toBe(takeId)
  })

  /**
   * **壊れた行を黙って読み替えない。** 成功なのに Take が無い行を「まだ」に畳むと、
   * どこで落ちたか追えなくなる。
   */
  it('状態と中身が食い違う行は、読んだ時点で止める', () => {
    expect(() => upscaleJobRowToDomain({ ...baseRow(), status: 'succeeded' })).toThrow(/Take/)
    expect(() => upscaleJobRowToDomain({ ...baseRow(), status: 'failed' })).toThrow(/理由/)
  })
})
