import { describe, expect, it } from 'vitest'
import { MasteringMode, hasAudibleTakeAudio, resolveMasteringMode } from '../audio/mastering.js'
import { CreateShotInput, MAX_TAKE_AUDIO_VOLUME, UpdateShotPatch, isTakeAudioMuted } from '../shot/shot.js'
import { Project } from '../project/project.js'
import { RenderJob } from '../render/render.js'
import { TimelineDocument } from '../timeline/timeline.js'

/** ADR-0060: Take の音の大きさと消音、書き出しの仕上げ。 */

describe('Shot の Take の音', () => {
  it(`大きさは 0〜${String(MAX_TAKE_AUDIO_VOLUME)}`, () => {
    expect(UpdateShotPatch.safeParse({ takeAudioVolume: 0 }).success).toBe(true)
    expect(UpdateShotPatch.safeParse({ takeAudioVolume: MAX_TAKE_AUDIO_VOLUME }).success).toBe(true)
    expect(UpdateShotPatch.safeParse({ takeAudioVolume: -0.01 }).success).toBe(false)
    expect(UpdateShotPatch.safeParse({ takeAudioVolume: MAX_TAKE_AUDIO_VOLUME + 0.01 }).success).toBe(false)
  })

  it('消音は真偽か null（自動に戻す）', () => {
    expect(UpdateShotPatch.safeParse({ takeAudioMuted: true }).success).toBe(true)
    expect(UpdateShotPatch.safeParse({ takeAudioMuted: null }).success).toBe(true)
    expect(UpdateShotPatch.safeParse({ takeAudioMuted: 'yes' }).success).toBe(false)
  })

  it('自動（null）は、セリフのある Shot だけ鳴らす。選んだらその通り', () => {
    const talking = [{ text: 'ねえ' }]
    expect(isTakeAudioMuted({ takeAudioMuted: null, dialogue: [] })).toBe(true)
    expect(isTakeAudioMuted({ takeAudioMuted: null, dialogue: talking })).toBe(false)
    expect(isTakeAudioMuted({ takeAudioMuted: false, dialogue: [] })).toBe(false)
    expect(isTakeAudioMuted({ takeAudioMuted: true, dialogue: talking })).toBe(true)
  })

  it('新しい Shot は自動・大きさ 1 で始まる（MV に足した Shot は頼んでいない音を鳴らさない）', () => {
    const created = CreateShotInput.parse({
      projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      sequenceId: null,
      order: 1000,
      code: 'shot_001',
      startSec: 0,
      durationSec: 2,
      camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
      mood: null,
      sourceType: { type: 'ai_video' },
    })
    expect(created).toMatchObject({ takeAudioVolume: 1, takeAudioMuted: null })
  })
})

describe('書き出しの仕上げ', () => {
  it('選んでいなければ、Take の音を鳴らす Shot があれば山だけ抑える（セリフの文ではなく、実際に鳴るか）', () => {
    expect(resolveMasteringMode(null, true)).toBe('peak')
    expect(resolveMasteringMode(null, false)).toBe('loudnorm')
  })

  it('鳴らす Shot は、タイムラインの video1 に音を持つ Shot', () => {
    expect(hasAudibleTakeAudio([{}, { audio: { volume: 1 } }])).toBe(true)
    expect(hasAudibleTakeAudio([{}, {}])).toBe(false)
    expect(hasAudibleTakeAudio([])).toBe(false)
  })

  it('制作者が選んだら、鳴るかどうかで変えない', () => {
    expect(resolveMasteringMode('loudnorm', true)).toBe('loudnorm')
    expect(resolveMasteringMode('peak', false)).toBe('peak')
  })

  it('知らない仕上げを拒む', () => {
    expect(MasteringMode.safeParse('limiter').success).toBe(false)
    expect(Project.shape.masteringMode.safeParse('limiter').success).toBe(false)
    expect(Project.shape.masteringMode.parse(undefined)).toBeNull()
  })

  it('前からの書き出しのジョブは全体をそろえた扱い', () => {
    expect(RenderJob.shape.masteringMode.parse(undefined)).toBe('loudnorm')
  })
})

describe('タイムラインの Take の音', () => {
  const doc = (audio: unknown) => ({
    version: 1,
    fps: 24,
    resolution: { width: 1920, height: 1080 },
    durationSec: 2,
    video1: [{ shotId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', startSec: 0, durationSec: 2, mediaUrl: 'a.mp4', inSec: 0, ...(audio === undefined ? {} : { audio }) }],
    transitions: [],
    clips: [],
    audio: [],
  })

  it('鳴らす Shot だけが音を持つ。無ければ前と同じ形', () => {
    expect(TimelineDocument.safeParse(doc(undefined)).success).toBe(true)
    expect(TimelineDocument.safeParse(doc({ volume: 1.5 })).success).toBe(true)
  })

  it('大きさは 0〜2', () => {
    expect(TimelineDocument.safeParse(doc({ volume: -0.1 })).success).toBe(false)
    expect(TimelineDocument.safeParse(doc({ volume: 2.1 })).success).toBe(false)
  })
})
