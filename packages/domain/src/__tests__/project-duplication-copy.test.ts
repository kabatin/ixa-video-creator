import { describe, expect, it } from 'vitest'
import {
  CharacterId,
  CharacterLookId,
  LocationId,
  MediaAssetId,
  ProjectId,
  SequenceId,
  ShotId,
  TakeId,
  TextStyleId,
  TimelineClipId,
  TransitionId,
  newId,
} from '../common/ids.js'
import { computeSpecHash } from '../generation/spec-compiler.js'
import type { ShotGenerationSpec } from '../generation/spec.js'
import { Take } from '../generation/take.js'
import {
  copyCastEntries,
  copyClipInput,
  copyShotInput,
  copyTakeInput,
  copyTransitionInputs,
  duplicationNotes,
} from '../project/duplication-copy.js'
import { Shot, ShotCharacter, Transition } from '../shot/shot.js'
import type { ShotSourceType } from '../shot/source-type.js'
import { TimelineClip } from '../timeline/timeline.js'

/**
 * 作品の複製で、行を新しい作品へ写す規則（制作者 2026-10-04）。**ID は新しく、画像・動画のファイルは同じものを指す。**
 * 持っていかなかったものへの参照は外し、外した数を知らせに使う。
 */

const SOURCE_PROJECT = newId(ProjectId)
const TARGET_PROJECT = newId(ProjectId)
const AT = new Date('2026-10-05T00:00:00.000Z')

const aShot = (patch: Partial<Shot> = {}): Shot =>
  Shot.parse({
    id: newId(ShotId),
    projectId: SOURCE_PROJECT,
    sequenceId: null,
    order: 1000,
    code: 'CUT-01',
    startSec: 1.5,
    durationSec: 2.25,
    sourceInSec: 0,
    timing: 'fit',
    description: '店の前に立つ戦子',
    dialogue: null,
    camera: { size: 'medium', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
    mood: '気合い',
    continuityMode: 'previous_shot',
    locationId: null,
    sourceType: { type: 'ai_video' },
    selectedTakeId: null,
    status: 'approved',
    lockedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  })

describe('copyShotInput', () => {
  it('位置・カメラ・つなぎ方を写し、新しい作品の Shot にする（状態は呼び出し側が決める）', () => {
    const shot = aShot()
    const { input } = copyShotInput(shot, {
      projectId: TARGET_PROJECT,
      keepStoryboard: true,
      locations: new Map(),
      sequences: new Map(),
      takes: new Map(),
      status: 'draft',
    })

    expect(input).toMatchObject({
      projectId: TARGET_PROJECT,
      code: 'CUT-01',
      order: 1000,
      startSec: 1.5,
      durationSec: 2.25,
      timing: 'fit',
      continuityMode: 'previous_shot',
      description: '店の前に立つ戦子',
      mood: '気合い',
      status: 'draft',
    })
  })

  it('絵コンテを持っていかなければ、説明と雰囲気を空にする', () => {
    const { input } = copyShotInput(aShot({ dialogue: 'いくよ' }), {
      projectId: TARGET_PROJECT,
      keepStoryboard: false,
      locations: new Map(),
      sequences: new Map(),
      takes: new Map(),
      status: 'draft',
    })

    expect(input).toMatchObject({ description: '', mood: null, dialogue: null })
  })

  it('ロケーションは写した先へ付け替え、写していなければ外して知らせる', () => {
    const before = newId(LocationId)
    const after = newId(LocationId)
    const base = { projectId: TARGET_PROJECT, keepStoryboard: true, sequences: new Map(), takes: new Map(), status: 'draft' as const }

    const kept = copyShotInput(aShot({ locationId: before }), { ...base, locations: new Map([[before, after]]) })
    const dropped = copyShotInput(aShot({ locationId: before }), { ...base, locations: new Map() })

    expect(kept).toMatchObject({ input: { locationId: after }, locationDropped: false })
    expect(dropped).toMatchObject({ input: { locationId: null }, locationDropped: true })
  })

  it('前の Take から作る指定は、写した Take へ付け替える（無ければ外す）。シーケンスも付け替える', () => {
    const keyframe = newId(TakeId)
    const copiedKeyframe = newId(TakeId)
    const sequence = newId(SequenceId)
    const copiedSequence = newId(SequenceId)
    const sourceType: ShotSourceType = { type: 'ai_image_to_video', keyframeTakeId: keyframe }
    const base = { projectId: TARGET_PROJECT, keepStoryboard: true, locations: new Map(), status: 'draft' as const }

    const kept = copyShotInput(aShot({ sourceType, sequenceId: sequence }), {
      ...base,
      sequences: new Map([[sequence, copiedSequence]]),
      takes: new Map([[keyframe, copiedKeyframe]]),
    })
    const dropped = copyShotInput(aShot({ sourceType }), { ...base, sequences: new Map(), takes: new Map() })

    expect(kept.input).toMatchObject({ sequenceId: copiedSequence, sourceType: { type: 'ai_image_to_video', keyframeTakeId: copiedKeyframe } })
    expect(dropped.input.sourceType).toEqual({ type: 'ai_image_to_video', keyframeTakeId: null })
  })
})

describe('copyCastEntries', () => {
  it('写したキャラクターと Look へ付け替え、写していない人は外して数える', () => {
    const shotId = newId(ShotId)
    const kept = { character: newId(CharacterId), look: newId(CharacterLookId) }
    const gone = { character: newId(CharacterId), look: newId(CharacterLookId) }
    const copied = { character: newId(CharacterId), look: newId(CharacterLookId) }
    const entries = [
      ShotCharacter.parse({ shotId, characterId: kept.character, lookId: kept.look, prominence: 'primary', order: 0 }),
      ShotCharacter.parse({ shotId, characterId: gone.character, lookId: gone.look, prominence: 'secondary', order: 1 }),
    ]

    const result = copyCastEntries(entries, {
      characters: new Map([[kept.character, copied.character]]),
      looks: new Map([[kept.look, copied.look]]),
    })

    expect(result.entries).toEqual([{ characterId: copied.character, lookId: copied.look, prominence: 'primary', order: 0 }])
    expect(result.dropped).toBe(1)
  })
})

describe('copyClipInput', () => {
  const style = newId(TextStyleId)
  const copiedStyle = newId(TextStyleId)
  const telop = TimelineClip.parse({
    id: newId(TimelineClipId),
    projectId: SOURCE_PROJECT,
    track: 'TEXT',
    startSec: 3,
    durationSec: 2,
    content: { type: 'text', templateKey: 'plain', params: { text: '夜明けの屋上で', styleId: style, lyricLine: 0, style: { size: 64 } } },
    createdAt: AT,
  })

  it('テロップの見た目は写した見た目へ付け替え、歌詞との結び付きを残す', () => {
    const { input, lyricLinkDropped } = copyClipInput(telop, {
      projectId: TARGET_PROJECT,
      styles: new Map([[style, copiedStyle]]),
      keepLyricLink: true,
    })

    expect(input).toMatchObject({ projectId: TARGET_PROJECT, track: 'TEXT', startSec: 3, durationSec: 2 })
    expect(input.content).toEqual({
      type: 'text',
      templateKey: 'plain',
      params: { text: '夜明けの屋上で', styleId: copiedStyle, lyricLine: 0, style: { size: 64 } },
    })
    expect(lyricLinkDropped).toBe(false)
  })

  it('作品の方針（歌詞）を持っていかなければ、文字は残して歌詞との結び付きだけ外す', () => {
    const { input, lyricLinkDropped } = copyClipInput(telop, { projectId: TARGET_PROJECT, styles: new Map(), keepLyricLink: false })

    expect(input.content).toEqual({
      type: 'text',
      templateKey: 'plain',
      params: { text: '夜明けの屋上で', styleId: null, style: { size: 64 } },
    })
    expect(lyricLinkDropped).toBe(true)
  })

  it('重ね素材（画像・動画・音）は同じファイルを指したまま写す', () => {
    const media = TimelineClip.parse({
      id: newId(TimelineClipId),
      projectId: SOURCE_PROJECT,
      track: 'SFX',
      startSec: 0,
      durationSec: 1,
      content: { type: 'media', mediaAssetId: newId(MediaAssetId), inSec: 0, outSec: 1 },
      createdAt: AT,
    })

    const { input } = copyClipInput(media, { projectId: TARGET_PROJECT, styles: new Map(), keepLyricLink: false })

    expect(input.content).toEqual(media.content)
    expect(input.projectId).toBe(TARGET_PROJECT)
  })
})

describe('copyTransitionInputs', () => {
  it('両側の Shot を写したときだけ、写した Shot の間に置く', () => {
    const [a, b, c] = [newId(ShotId), newId(ShotId), newId(ShotId)]
    const [a2, b2] = [newId(ShotId), newId(ShotId)]
    const transitions = [
      Transition.parse({ id: newId(TransitionId), projectId: SOURCE_PROJECT, fromShotId: a, toShotId: b, type: 'dissolve', durationSec: 0.5 }),
      Transition.parse({ id: newId(TransitionId), projectId: SOURCE_PROJECT, fromShotId: b, toShotId: c, type: 'cut' }),
    ]

    const inputs = copyTransitionInputs(transitions, { projectId: TARGET_PROJECT, shots: new Map([[a, a2], [b, b2]]) })

    expect(inputs).toEqual([{ projectId: TARGET_PROJECT, fromShotId: a2, toShotId: b2, type: 'dissolve', durationSec: 0.5 }])
  })
})

describe('copyTakeInput', () => {
  const shotId = newId(ShotId)
  const spec: ShotGenerationSpec = {
    specVersion: 1,
    shotId,
    sourceType: 'ai_video',
    prompt: '店の前に立つ戦子',
    negativePrompt: null,
    promptParts: {
      styleGuide: '',
      shotDescription: '店の前に立つ戦子',
      identityAnchors: [],
      styleTokens: [],
      colorPalette: [],
      wardrobeTokens: [],
      cameraFragment: '',
      moodFragment: null,
    },
    durationSec: 4,
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    fps: 24,
    seed: null,
    references: [{ mediaAssetId: newId(MediaAssetId), role: 'subject', weight: 1 }],
    camera: { size: 'medium', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
  }
  const aTake = async (patch: Partial<Take> = {}): Promise<Take> =>
    Take.parse({
      id: newId(TakeId),
      shotId,
      index: 2,
      mediaAssetId: newId(MediaAssetId),
      spec,
      specHash: await computeSpecHash(spec),
      providerId: 'vpipe',
      modelId: 'vpipe/minimax-h3-turbo-draft',
      providerParams: { kind: 'http', request: {} },
      seedUsed: 7,
      costUsd: 0.25,
      generationTimeSec: 251,
      parentTakeId: null,
      regenerationReason: null,
      reviewStatus: 'warned',
      humanVerdict: 'approved',
      createdAt: AT,
      ...patch,
    })

  it('新しい ID と Shot に付け替え、生成の記録の Shot も書き換えてハッシュを計算し直す（ファイルは同じ）', async () => {
    const take = await aTake()
    const copiedShot = newId(ShotId)
    const copiedTake = newId(TakeId)

    const input = await copyTakeInput(take, { shots: new Map([[shotId, copiedShot]]), takes: new Map([[take.id, copiedTake]]) })

    expect(input).toMatchObject({
      id: copiedTake,
      shotId: copiedShot,
      mediaAssetId: take.mediaAssetId,
      providerId: 'vpipe',
      costUsd: 0.25,
      generationTimeSec: 251,
      spec: { ...spec, shotId: copiedShot },
    })
    expect(input.specHash).toBe(await computeSpecHash({ ...spec, shotId: copiedShot }))
    expect(input.specHash).not.toBe(take.specHash)
  })

  it('作り直しの元は写した Take へ付け替え、無ければ外して理由は残す', async () => {
    const parent = newId(TakeId)
    const copiedParent = newId(TakeId)
    const take = await aTake({ parentTakeId: parent, regenerationReason: '顔が崩れた' })
    const shots = new Map([[shotId, newId(ShotId)]])

    const kept = await copyTakeInput(take, { shots, takes: new Map([[take.id, newId(TakeId)], [parent, copiedParent]]) })
    const dropped = await copyTakeInput(take, { shots, takes: new Map([[take.id, newId(TakeId)]]) })

    expect(kept).toMatchObject({ parentTakeId: copiedParent, regenerationReason: '顔が崩れた' })
    expect(dropped).toMatchObject({ parentTakeId: null, regenerationReason: '顔が崩れた' })
  })

  it('Take か Shot の付け替え先が無ければ、作り損ねとして投げる（黙って元の ID で作らない）', async () => {
    const take = await aTake()

    await expect(copyTakeInput(take, { shots: new Map(), takes: new Map([[take.id, newId(TakeId)]]) })).rejects.toThrow()
    await expect(copyTakeInput(take, { shots: new Map([[shotId, newId(ShotId)]]), takes: new Map() })).rejects.toThrow()
  })
})

describe('duplicationNotes', () => {
  it('外したものを、数と理由で言う（ID を出さない）', () => {
    expect(duplicationNotes({ castDropped: 12, locationDropped: 3, lyricLinksDropped: 20 })).toEqual([
      'キャラクターを持っていかなかったので、Shot 12 件の登場人物を外しました',
      'ロケーションを持っていかなかったので、Shot 3 件のロケーションを外しました',
      '作品の方針を持っていかなかったので、テロップ 20 件の歌詞との結び付きを外しました（文字は残っています）',
    ])
  })

  it('何も外していなければ何も言わない', () => {
    expect(duplicationNotes({ castDropped: 0, locationDropped: 0, lyricLinksDropped: 0 })).toEqual([])
  })
})
