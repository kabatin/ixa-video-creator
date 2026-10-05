import {
  DEFAULT_NARRATION_TEXT_STYLE,
  MediaAssetId,
  NARRATION_STYLE_NAME,
  ProjectId,
  VoiceJobId,
  narrationLineOf,
  newId,
  type NarrationLine,
  type TimelineClip,
} from '@ixa/domain'
import { DbNotFoundError } from '@ixa/db'
import { describe, expect, it } from 'vitest'
import { syncNarrationTelops } from '../narration-telops.js'
import {
  createInMemoryAudioSettingsRepository,
  createInMemoryNarrationLineRepository,
  createInMemoryNarrationTakeRepository,
  createInMemoryTextStyleRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryVoiceProfileRepository,
} from '../testing.js'

/**
 * ナレーションのテロップを、行に合わせて作り直す（ADR-0038）。ナレーションから作ったテロップだけを差し替え、
 * 手で置いたテロップ・歌詞は触らない。中身が変わらなければ書き換えない。
 */

const PROJECT = newId(ProjectId)

const setup = async () => {
  const deps = {
    lines: createInMemoryNarrationLineRepository(),
    takes: createInMemoryNarrationTakeRepository(),
    voices: createInMemoryVoiceProfileRepository(),
    audioSettings: createInMemoryAudioSettingsRepository(),
    textStyles: createInMemoryTextStyleRepository(),
    timelineClips: createInMemoryTimelineClipRepository(),
  }
  const [line] = await deps.lines.createMany([{ projectId: PROJECT, order: 0, text: 'あいうえ。かきくけ。', startSec: 10 }])
  if (line === undefined) throw new Error('行がありません')
  const take = await deps.takes.create({
    lineId: line.id,
    source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'stub', model: null, voiceName: 'stub' },
    mediaAssetId: newId(MediaAssetId),
    inSec: 0,
    outSec: 2.4,
    spokenText: 'あいうえ。かきくけ。',
    displayText: 'あいうえ。かきくけ。',
    specHash: null,
    charTimes: null,
    loudnessLufs: null,
    peaks: null,
    costUsd: 0,
  })
  await deps.lines.update(line.id, { selectedTakeId: take.id })
  return { deps, line }
}

const telopsOf = (clips: readonly TimelineClip[]) =>
  clips.filter((clip) => clip.content.type === 'text' && narrationLineOf(clip.content.params) !== null)

const textOf = (clip: TimelineClip | undefined): unknown =>
  clip?.content.type === 'text' ? clip.content.params['text'] : undefined

describe('syncNarrationTelops', () => {
  it('置いて声を選んだ行のテロップを作る（句点で分ける）', async () => {
    const { deps, line } = await setup()

    expect(await syncNarrationTelops(deps, PROJECT)).toEqual({ changed: true, count: 2 })

    const telops = telopsOf(deps.timelineClips.snapshot())
    expect(telops.map(textOf)).toEqual(['あいうえ。', 'かきくけ。'])
    expect(telops.map((clip) => (clip.content.type === 'text' ? narrationLineOf(clip.content.params) : null))).toEqual([line.id, line.id])
  })

  it('もう一度呼んでも、中身が同じなら書き換えない（クリップの ID が変わらない）', async () => {
    const { deps } = await setup()
    await syncNarrationTelops(deps, PROJECT)
    const before = deps.timelineClips.snapshot().map((clip) => clip.id)

    expect(await syncNarrationTelops(deps, PROJECT)).toEqual({ changed: false, count: 2 })
    expect(deps.timelineClips.snapshot().map((clip) => clip.id)).toEqual(before)
  })

  it('行を動かすと、そのテロップも付いてくる（前のテロップは消える）', async () => {
    const { deps, line } = await setup()
    await syncNarrationTelops(deps, PROJECT)
    await deps.lines.update(line.id, { startSec: 20 })

    expect((await syncNarrationTelops(deps, PROJECT)).changed).toBe(true)
    expect(telopsOf(deps.timelineClips.snapshot()).map((clip) => clip.startSec)).toEqual([20, 21.2])
  })

  it('テロップを外した行・置いていない行のテロップは消す', async () => {
    const { deps, line } = await setup()
    await syncNarrationTelops(deps, PROJECT)
    await deps.lines.update(line.id, { telop: false })

    expect(await syncNarrationTelops(deps, PROJECT)).toEqual({ changed: true, count: 0 })
    expect(telopsOf(deps.timelineClips.snapshot())).toEqual([])
  })

  it('手で置いたテロップ・歌詞のテロップは触らない', async () => {
    const { deps, line } = await setup()
    const manual = await deps.timelineClips.create({
      projectId: PROJECT,
      track: 'TEXT',
      startSec: 0,
      durationSec: 2,
      content: { type: 'text', templateKey: 'plain', params: { text: '手で置いた' } },
    })
    await syncNarrationTelops(deps, PROJECT)
    await deps.lines.update(line.id, { text: 'さしすせ。' })
    await syncNarrationTelops(deps, PROJECT)

    const clips = deps.timelineClips.snapshot()
    expect(clips.find((clip) => clip.id === manual.id)).toEqual(manual)
    expect(telopsOf(clips).map(textOf)).toEqual(['さしすせ。'])
  })

  it('見た目は、声の見た目 → 「ナレーション」の見た目 → 既定 の順に選ぶ（当て直す行だけ選び直す）', async () => {
    const { deps, line } = await setup()
    await syncNarrationTelops(deps, PROJECT)
    expect(telopsOf(deps.timelineClips.snapshot())[0]?.content).toMatchObject({ params: { style: DEFAULT_NARRATION_TEXT_STYLE } })

    const named = await deps.textStyles.create(PROJECT, { name: NARRATION_STYLE_NAME, style: { anchor: 'top-center' } })
    await syncNarrationTelops(deps, PROJECT, { restyle: [line.id] })
    expect(telopsOf(deps.timelineClips.snapshot())[0]?.content).toMatchObject({ params: { style: { anchor: 'top-center' }, styleId: named.id } })

    const own = await deps.textStyles.create(PROJECT, { name: '戦子', style: { anchor: 'middle-left' } })
    const voice = await deps.voices.create({ projectId: PROJECT, name: '戦子の声', tool: 'stub', voiceName: 'stub', textStyleId: own.id })
    await deps.lines.update(line.id, { voiceProfileId: voice.id } satisfies Partial<NarrationLine>)
    await syncNarrationTelops(deps, PROJECT, { restyle: [line.id] })
    expect(telopsOf(deps.timelineClips.snapshot())[0]?.content).toMatchObject({ params: { style: { anchor: 'middle-left' }, styleId: own.id } })
  })

  it('手で当てた見た目は、行を直して作り直しても引き継ぐ（見た目は当てたときに写す。ADR-0028）', async () => {
    const { deps, line } = await setup()
    await syncNarrationTelops(deps, PROJECT)
    const [first] = telopsOf(deps.timelineClips.snapshot())
    if (first?.content.type !== 'text') throw new Error('テロップがありません')
    await deps.timelineClips.update(first.id, { content: { ...first.content, params: { ...first.content.params, style: { anchor: 'top-left' }, styleId: null } } })
    await deps.textStyles.create(PROJECT, { name: NARRATION_STYLE_NAME, style: { anchor: 'top-center' } })

    await deps.lines.update(line.id, { startSec: 30 })
    await syncNarrationTelops(deps, PROJECT)

    const telops = telopsOf(deps.timelineClips.snapshot())
    expect(telops.map((clip) => clip.startSec)).toEqual([30, 31.2])
    expect(telops.map((clip) => (clip.content.type === 'text' ? clip.content.params['style'] : null))).toEqual([{ anchor: 'top-left' }, { anchor: 'top-left' }])
  })

  it('ほかの作り直し（声ができた・行を動かした）と重なって消す相手が先に消えていたら、読み直して 1 度だけやり直す', async () => {
    const { deps } = await setup()
    await syncNarrationTelops(deps, PROJECT)
    let first = true
    const racing = {
      ...deps.timelineClips,
      replace: async (...args: Parameters<typeof deps.timelineClips.replace>) => {
        if (first) {
          first = false
          // 先に別の作り直しが同じ相手を消した。
          await deps.timelineClips.replace(args[0], [])
          return Promise.reject(new DbNotFoundError('TimelineClip', String(args[0][0])))
        }
        return deps.timelineClips.replace(...args)
      },
    }
    const [line] = await deps.lines.findByProject(PROJECT)
    if (line === undefined) throw new Error('行がありません')
    await deps.lines.update(line.id, { startSec: 20 })

    expect((await syncNarrationTelops({ ...deps, timelineClips: racing }, PROJECT)).changed).toBe(true)
    expect(telopsOf(deps.timelineClips.snapshot()).map((clip) => clip.startSec)).toEqual([20, 21.2])
  })

  it('話している字の強調を入れると、字の時刻がある声のテロップに色と時刻が付く', async () => {
    const { deps, line } = await setup()
    const text = 'あいうえ。かきくけ。'
    const charTimes = [...text].map((char, i) => ({ char, startSec: i * 0.24, endSec: (i + 1) * 0.24 }))
    const take = await deps.takes.create({
      lineId: line.id,
      source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'stub', model: null, voiceName: 'stub' },
      mediaAssetId: newId(MediaAssetId),
      inSec: 0,
      outSec: 2.4,
      spokenText: text,
      displayText: text,
      specHash: null,
      charTimes,
      loudnessLufs: null,
      peaks: null,
      costUsd: 0,
    })
    await deps.lines.update(line.id, { selectedTakeId: take.id })
    const settings = await deps.audioSettings.get(PROJECT)
    await deps.audioSettings.save({ ...settings, telopHighlight: { enabled: true, color: '#ff0000' } })

    await syncNarrationTelops(deps, PROJECT)

    expect(telopsOf(deps.timelineClips.snapshot())[0]?.content).toMatchObject({ params: { highlight: { color: '#ff0000' } } })
  })
})
