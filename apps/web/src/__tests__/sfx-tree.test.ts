import { describe, expect, it } from 'vitest'
import { SFX_LABEL_MAX_CHARS, sfxTreeItems } from '@/lib/sfx-tree'
import { WireSfxJob } from '@/lib/sfx-job-api'
import { WireTimelineClip } from '@/lib/timeline-api'

const PROJECT = '01ARZ3NDEKTSV4RRFFQ69G5FA0'
const SOUND_A = '01ARZ3NDEKTSV4RRFFQ69G5FA1'
const SOUND_B = '01ARZ3NDEKTSV4RRFFQ69G5FA2'
const SOUND_C = '01ARZ3NDEKTSV4RRFFQ69G5FA3'

const clip = (
  id: string,
  track: string,
  startSec: number,
  mediaAssetId: string,
  inSec = 0,
  outSec = 1,
  durationSec = outSec - inSec,
) =>
  WireTimelineClip.parse({
    id,
    projectId: PROJECT,
    track,
    startSec,
    durationSec,
    content: { type: 'media', mediaAssetId, inSec, outSec, volume: 1 },
    createdAt: new Date().toISOString(),
  })

const job = (prompt: string, mediaAssetIds: readonly string[], status = 'succeeded', id = '01ARZ3NDEKTSV4RRFFQ69G5FB0') =>
  WireSfxJob.parse({
    id,
    status,
    cue: { startSec: 0, durationSec: 1, prompt, volume: 1 },
    mediaAssetIds,
    timelineClipId: null,
  })

describe('sfxTreeItems', () => {
  it('同じ音を 2 か所に置いても 1 行にまとめ、置いた位置を早い順に添える', () => {
    const items = sfxTreeItems(
      [
        clip('01ARZ3NDEKTSV4RRFFQ69G5FC1', 'SFX', 8, SOUND_A),
        clip('01ARZ3NDEKTSV4RRFFQ69G5FC2', 'SFX', 2, SOUND_A, 0.25, 0.75),
      ],
      [],
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.placements.map((p) => [p.startSec, p.inSec, p.durationSec])).toEqual([
      [2, 0.25, 0.5],
      [8, 0, 1],
    ])
    // 作った記録の無い音（落とした音）は最初に置いた位置で呼ぶ。内部の ID は出さない。
    expect(items[0]?.label).toBe('効果音（0:02.00）')
  })

  it('効果音の段以外のクリップは入れない', () => {
    expect(sfxTreeItems([clip('01ARZ3NDEKTSV4RRFFQ69G5FC3', 'VIDEO2', 1, SOUND_A)], [])).toEqual([])
  })

  it('作った音はきっかけの文で呼び、置いていない候補も並べる（置いた音が先）', () => {
    const items = sfxTreeItems(
      [clip('01ARZ3NDEKTSV4RRFFQ69G5FC4', 'SFX', 3, SOUND_B)],
      [job('whoosh', [SOUND_B, SOUND_C])],
    )
    expect(items.map((item) => [item.mediaAssetId, item.label, item.placements.length])).toEqual([
      [SOUND_B, 'whoosh', 1],
      [SOUND_C, 'whoosh（候補 2）', 0],
    ])
  })

  it('できていないジョブの音は名前にも行にも使わない', () => {
    expect(sfxTreeItems([], [job('boing', [SOUND_A], 'failed')])).toEqual([])
  })

  it('長いきっかけの文は詰める', () => {
    const [item] = sfxTreeItems([], [job('x'.repeat(SFX_LABEL_MAX_CHARS + 10), [SOUND_A])])
    expect(item?.label).toHaveLength(SFX_LABEL_MAX_CHARS)
    expect(item?.label.endsWith('…')).toBe(true)
  })
})

describe('sfxTreeItems の長さと名前', () => {
  /** 帯で端をつまむと startSec / durationSec だけが書かれる。レンダラは inSec から durationSec だけ鳴らす。 */
  it('鳴らす長さはクリップの durationSec（outSec − inSec ではない）', () => {
    const [item] = sfxTreeItems([clip('01ARZ3NDEKTSV4RRFFQ69G5FC5', 'SFX', 1, SOUND_A, 0.2, 1.2, 0.4)], [])
    expect(item?.placements[0]?.durationSec).toBe(0.4)
  })

  it('同じ音が複数のジョブにあれば、新しいジョブ（先に届く）の文を名前にする', () => {
    const [item] = sfxTreeItems(
      [],
      [job('newer', [SOUND_A], 'succeeded', '01ARZ3NDEKTSV4RRFFQ69G5FB1'), job('older', [SOUND_A])],
    )
    expect(item?.label).toBe('newer')
  })
})

describe('WireSfxJob', () => {
  it('素材の ID の形でない音は読み込みで落とす（行を黙って捨てない）', () => {
    expect(() => job('x', ['not-a-media-id'])).toThrow()
  })
})
