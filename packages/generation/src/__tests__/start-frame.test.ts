import { MediaAssetId as MediaAssetIdSchema, ShotId as ShotIdSchema, newId } from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearManualStartFrame, manualStartFrameOf, replaceManualStartFrame } from '../start-frame.js'
import { createInMemoryShotReferenceRepository, type InMemoryShotReferenceRepository } from '../testing.js'

/**
 * Shot の「最初のフレーム」（ADR-0025）の差し替え。**API（手で付ける）と worker（絵コンテの画像、
 * ADR-0029）が同じ規則を使う。** 書き写すと片方だけ直ってずれる。
 */

const shotId = newId(ShotIdSchema)
const first = newId(MediaAssetIdSchema)
const second = newId(MediaAssetIdSchema)
let references: InMemoryShotReferenceRepository

beforeEach(() => {
  references = createInMemoryShotReferenceRepository()
})

describe('最初のフレーム', () => {
  it('差し替えると、手で付けたものは 1 枚だけになる', async () => {
    await replaceManualStartFrame(references, shotId, first)
    await replaceManualStartFrame(references, shotId, second)

    expect(await manualStartFrameOf(references, shotId)).toBe(second)
    expect(references.snapshot().filter((reference) => reference.role === 'start_frame')).toHaveLength(1)
  })

  it('導かれた参照（手で付けたもの以外）には触らない', async () => {
    await references.create({ shotId, mediaAssetId: first, role: 'start_frame', weight: 1, order: 0, sourceKind: 'derived_location' })

    await replaceManualStartFrame(references, shotId, second)
    await clearManualStartFrame(references, shotId)

    expect(references.snapshot().map((reference) => reference.mediaAssetId)).toEqual([first])
  })

  it('外すと無くなる', async () => {
    await replaceManualStartFrame(references, shotId, first)
    await clearManualStartFrame(references, shotId)

    expect(await manualStartFrameOf(references, shotId)).toBeNull()
  })
})
