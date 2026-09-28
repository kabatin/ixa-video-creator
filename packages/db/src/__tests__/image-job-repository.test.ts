import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { imageJobRowToDomain, type ImageJobRow } from '../repositories/image-job-repository.js'
import { imageGenerationJobs } from '../schema/image-job.js'

/**
 * 絵コンテの画像を作るジョブ（ADR-0029）。実 DB には接続しない。行 → domain の変換と、
 * 状態と中身の食い違いを読み直す側でも止めることを確かめる。
 */

const row = (patch: Partial<ImageJobRow> = {}): ImageJobRow => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  shotId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  status: 'queued',
  providerId: 'codex-cli',
  modelId: 'codex-cli/image-gen',
  referenceAssetIds: [],
  mediaAssetId: null,
  error: null,
  providerRecord: null,
  queuedAt: new Date('2026-09-28T00:00:00Z'),
  startedAt: null,
  finishedAt: null,
  ...patch,
})

describe('image_generation_jobs', () => {
  it('行を domain の型にする', () => {
    expect(imageJobRowToDomain(row())).toMatchObject({ status: 'queued', providerId: 'codex-cli' })
  })

  it('成功したのに絵が無い行は通さない（黙って「絵なし」に畳まない）', () => {
    expect(() => imageJobRowToDomain(row({ status: 'succeeded' }))).toThrow(/成功したのに絵がありません/)
  })

  it('Shot ごと・Project の動いているジョブを引ける索引がある', () => {
    const names = getTableConfig(imageGenerationJobs).indexes.map((index) => index.config.name)
    expect(names).toEqual(
      expect.arrayContaining(['image_generation_jobs_shot_id_idx', 'image_generation_jobs_project_status_idx']),
    )
  })
})
