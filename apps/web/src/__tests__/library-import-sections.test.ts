import { MediaAssetId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { sfxImportChoices } from '@/lib/library-import-sections'
import type { WireSfxJob } from '@/lib/sfx-job-api'

/**
 * 取り込みの窓の「効果音」（ADR-0053）。取り込み元で作った音を 1 本 1 行で並べる（素材ツリーと同じ名前）。
 */

const cue = (prompt: string) => ({ startSec: 3.75, durationSec: 1.5, prompt, volume: 0.8 })

describe('sfxImportChoices', () => {
  it('できたジョブの音を 1 本ずつ並べ、2 本目から「候補 n」を添える', () => {
    const [a, b] = [newId(MediaAssetId), newId(MediaAssetId)]
    const job: WireSfxJob = { id: 'J1', status: 'succeeded', cue: cue('sword clash'), mediaAssetIds: [a, b], timelineClipId: null }

    expect(sfxImportChoices([job])).toEqual([
      { key: `J1:${a}`, sfxJobId: 'J1', mediaAssetId: a, label: 'sword clash' },
      { key: `J1:${b}`, sfxJobId: 'J1', mediaAssetId: b, label: 'sword clash（候補 2）' },
    ])
  })

  it('できていないジョブは出さず、同じ音は新しいジョブの 1 行にまとめる', () => {
    const shared = newId(MediaAssetId)
    const newer: WireSfxJob = { id: 'J2', status: 'succeeded', cue: cue('door slam'), mediaAssetIds: [shared], timelineClipId: null }
    const older: WireSfxJob = { id: 'J1', status: 'succeeded', cue: cue('door'), mediaAssetIds: [shared], timelineClipId: null }
    const failed: WireSfxJob = { id: 'J3', status: 'failed', cue: cue('boom'), mediaAssetIds: [], timelineClipId: null }

    expect(sfxImportChoices([failed, newer, older]).map((choice) => [choice.sfxJobId, choice.label])).toEqual([
      ['J2', 'door slam'],
    ])
  })
})
