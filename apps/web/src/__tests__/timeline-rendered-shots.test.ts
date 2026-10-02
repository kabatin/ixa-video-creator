import { ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { renderedShotIdsOf, type TimelineMaterials } from '@/lib/timeline-loader'
import type { WireTimelineDocument } from '@/lib/timeline-api'

/**
 * タイムラインの「採用 Take を解決できた Shot」（Take が無い Shot の印に使う）。
 * Take が無い Shot に絵コンテの画像を映すようになっても（制作者 2026-10-02）、絵の Shot は Take が無い側のまま。
 */

const take = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1')
const still = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2')

const documentOf = (video1: WireTimelineDocument['video1']): WireTimelineDocument => ({
  version: 1,
  fps: 24,
  resolution: { width: 1920, height: 1080 },
  durationSec: 8,
  video1,
  transitions: [],
  clips: [],
  audio: [],
})

const materialsWith = (document: WireTimelineDocument | null): TimelineMaterials =>
  ({ document: { value: document, error: null } }) as unknown as TimelineMaterials

describe('renderedShotIdsOf', () => {
  it('絵を映している Shot は入れない（Take はまだ無い）', () => {
    const document = documentOf([
      { shotId: take, startSec: 0, durationSec: 4, mediaUrl: 'https://media.test/a.mp4', inSec: 0 },
      { shotId: still, startSec: 4, durationSec: 4, mediaUrl: 'https://media.test/b.png', inSec: 0, kind: 'image' },
    ])

    expect(renderedShotIdsOf(materialsWith(document))).toEqual([take])
  })

  it('読めていなければ null', () => {
    expect(renderedShotIdsOf(materialsWith(null))).toBeNull()
  })
})
