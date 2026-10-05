import { describe, expect, it } from 'vitest'
import {
  MediaAssetId,
  NarrationLineId,
  NarrationTakeId,
  ProjectId,
  VoiceJobId,
  VoiceProfileId,
  newId,
} from '../common/ids.js'
import { CreateNarrationLineInput, NARRATION_TEXT_MAX, NarrationLine, lineReading } from '../narration/narration-line.js'
import { NarrationTake, takeDurationSec } from '../narration/narration-take.js'
import { CreateVoiceProfileInput, VoiceProfile } from '../narration/voice-profile.js'
import { voiceJobViolation, type VoiceJob } from '../narration/voice-job.js'
import { voiceSpecHash, voiceSpecOf } from '../narration/voice-spec.js'

/**
 * ナレーションの形（ADR-0038）。声（VoiceProfile）・原稿の行（NarrationLine）・声の Take（NarrationTake）・声のジョブ（VoiceJob）。
 */

const PROJECT = newId(ProjectId)
const NOW = new Date('2026-10-05T00:00:00Z')

const aVoice = (patch: Partial<VoiceProfile> = {}): VoiceProfile =>
  VoiceProfile.parse({
    id: newId(VoiceProfileId),
    projectId: PROJECT,
    name: 'ナレーター',
    tool: 'gemini_api',
    model: 'gemini-3.8-flash-tts',
    voiceName: 'Kore',
    styleNote: '落ち着いた低めの声',
    speed: 1,
    volume: 1,
    language: 'ja',
    tuning: {},
    textStyleId: null,
    characterId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  })

const aLine = (patch: Partial<NarrationLine> = {}): NarrationLine =>
  NarrationLine.parse({
    id: newId(NarrationLineId),
    projectId: PROJECT,
    order: 0,
    text: '進め、戦子ちゃん。',
    reading: null,
    voiceProfileId: null,
    direction: '',
    startSec: null,
    selectedTakeId: null,
    telop: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  })

describe('VoiceProfile', () => {
  it('作るときの既定: 速さ 1・音量 1・日本語・声のイメージは空・テロップの見た目は無し・誰の声でもない', () => {
    expect(
      CreateVoiceProfileInput.parse({ projectId: PROJECT, name: 'ナレーター', tool: 'macos_say', voiceName: 'Kyoko' }),
    ).toEqual({
      projectId: PROJECT,
      name: 'ナレーター',
      tool: 'macos_say',
      voiceName: 'Kyoko',
      model: null,
      styleNote: '',
      speed: 1,
      volume: 1,
      language: 'ja',
      tuning: {},
      textStyleId: null,
      characterId: null,
    })
  })

  it('速さは 0.5〜2、名前は 1〜40 字、声のイメージは 500 字まで', () => {
    expect(() => aVoice({ speed: 0.49 })).toThrow()
    expect(() => aVoice({ speed: 2.01 })).toThrow()
    expect(() => aVoice({ name: '' })).toThrow()
    expect(() => aVoice({ name: 'あ'.repeat(41) })).toThrow()
    expect(() => aVoice({ styleNote: 'あ'.repeat(501) })).toThrow()
    expect(aVoice({ speed: 0.5 }).speed).toBe(0.5)
  })

  it('声に使えるのはスタブ・Mac の声・Gemini・ElevenLabs だけ（廃止した gemini_cli は使えない）', () => {
    expect(() => aVoice({ tool: 'gemini_cli' as VoiceProfile['tool'] })).toThrow()
  })

  it('ElevenLabs の調整（安定・似せ方・表現）は 0〜1', () => {
    expect(aVoice({ tool: 'elevenlabs', tuning: { stability: 0.4 } }).tuning).toEqual({ stability: 0.4 })
    expect(() => aVoice({ tuning: { stability: 1.1 } })).toThrow()
  })
})

describe('NarrationLine', () => {
  it('作るときの既定: 読みは辞書から・声は未定・演出なし・まだ置いていない・テロップを付ける', () => {
    expect(CreateNarrationLineInput.parse({ projectId: PROJECT, order: 0, text: ' はい。 ' })).toEqual({
      projectId: PROJECT,
      order: 0,
      text: 'はい。',
      reading: null,
      voiceProfileId: null,
      direction: '',
      startSec: null,
      telop: true,
    })
  })

  it(`表示は 1〜${NARRATION_TEXT_MAX} 字`, () => {
    expect(() => aLine({ text: ' ' })).toThrow()
    expect(() => aLine({ text: 'あ'.repeat(NARRATION_TEXT_MAX + 1) })).toThrow()
    expect(aLine({ text: 'あ'.repeat(NARRATION_TEXT_MAX) }).text).toHaveLength(NARRATION_TEXT_MAX)
  })
})

describe('lineReading', () => {
  it('読みが空なら辞書から作る', () => {
    expect(lineReading(aLine(), [{ written: '戦子', reading: 'せんこ' }]).reading).toBe('進め、せんこちゃん。')
  })

  it('読みを手で入れてあればそれを使う（行全体を 1 つの置き換えとして持つ）', () => {
    const applied = lineReading(aLine({ reading: 'すすめ、せんこちゃん。' }), [])
    expect(applied.reading).toBe('すすめ、せんこちゃん。')
    expect(applied.spans).toEqual([{ display: { start: 0, end: 9 }, reading: { start: 0, end: 11 }, replaced: true }])
  })
})

describe('NarrationTake', () => {
  const take = {
    id: newId(NarrationTakeId),
    lineId: newId(NarrationLineId),
    index: 1,
    source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'macos_say', model: null, voiceName: 'Kyoko' },
    mediaAssetId: newId(MediaAssetId),
    inSec: 0,
    outSec: 2.4,
    spokenText: 'すすめ',
    displayText: '進め',
    specHash: 'abc',
    charTimes: null,
    loudnessLufs: -16,
    peaks: null,
    costUsd: 0,
    createdAt: NOW,
  }

  it('長さは区間の長さ', () => {
    expect(takeDurationSec(NarrationTake.parse({ ...take, inSec: 1, outSec: 3.5 }))).toBe(2.5)
  })

  it('区間の終わりは始まりより後', () => {
    expect(() => NarrationTake.parse({ ...take, inSec: 2, outSec: 2 })).toThrow()
  })
})

describe('voiceSpecHash', () => {
  const voice = aVoice()
  const line = aLine()
  const hashOf = (v = voice, l = line, dictionary = [{ written: '戦子', reading: 'せんこ' }]) =>
    voiceSpecHash(voiceSpecOf(v, l, lineReading(l, dictionary).reading))

  it('同じ読み・声・設定なら同じ（作り直さず前の Take を使える）', async () => {
    expect(await hashOf()).toBe(await hashOf())
  })

  it('読みが同じなら、表示を変えても同じ（読ませる字が変わらないので作り直さない）', async () => {
    expect(await hashOf(voice, aLine({ text: '進め、戦子ちゃん。' }))).toBe(
      await hashOf(voice, aLine({ text: '進め、せんこちゃん。' })),
    )
  })

  it('読み・声の種類・声のイメージ・速さ・演出のどれかが変われば変わる', async () => {
    const base = await hashOf()
    expect(await hashOf(voice, line, [])).not.toBe(base)
    expect(await hashOf(aVoice({ voiceName: 'Puck' }))).not.toBe(base)
    expect(await hashOf(aVoice({ styleNote: '明るく' }))).not.toBe(base)
    expect(await hashOf(aVoice({ speed: 1.2 }))).not.toBe(base)
    expect(await hashOf(voice, aLine({ direction: '囁くように' }))).not.toBe(base)
  })

  it('声の名前（画面の呼び名）や音量を変えても変わらない（読み上げの中身が同じ）', async () => {
    const base = await hashOf()
    expect(await hashOf(aVoice({ name: '語り手' }))).toBe(base)
    expect(await hashOf(aVoice({ volume: 0.5 }))).toBe(base)
  })
})

describe('voiceJobViolation', () => {
  const base: VoiceJob = {
    id: newId(VoiceJobId),
    projectId: PROJECT,
    kind: 'speak',
    lineId: newId(NarrationLineId),
    takeId: null,
    voiceProfileId: newId(VoiceProfileId),
    inputMediaAssetId: null,
    resultMediaAssetId: null,
    placeAtSec: null,
    tool: 'macos_say',
    model: null,
    spec: voiceSpecOf(aVoice({ tool: 'macos_say', voiceName: 'Kyoko', model: null }), aLine(), 'すすめ'),
    status: 'queued',
    costUsd: null,
    error: null,
    providerRecord: null,
    queuedAt: NOW,
    startedAt: null,
    finishedAt: null,
  }

  it('読む（speak）は行・声・指定が要る', () => {
    expect(voiceJobViolation(base)).toBeNull()
    expect(voiceJobViolation({ ...base, lineId: null })).toMatch(/行/)
    expect(voiceJobViolation({ ...base, spec: null })).toMatch(/指定/)
  })

  it('試しに読む（preview）は行が無くてよい', () => {
    expect(voiceJobViolation({ ...base, kind: 'preview', lineId: null })).toBeNull()
  })

  it('文字起こし（transcribe）は入れた音と、置く位置が要る', () => {
    const transcribe = { ...base, kind: 'transcribe' as const, lineId: null, spec: null, voiceProfileId: null }
    expect(voiceJobViolation(transcribe)).toMatch(/音/)
    expect(voiceJobViolation({ ...transcribe, inputMediaAssetId: newId(MediaAssetId) })).toMatch(/位置/)
    expect(voiceJobViolation({ ...transcribe, inputMediaAssetId: newId(MediaAssetId), placeAtSec: 0 })).toBeNull()
  })

  it('字の時刻を取る（char_timing）は Take が要る', () => {
    expect(
      voiceJobViolation({ ...base, kind: 'char_timing', spec: null, voiceProfileId: null, inputMediaAssetId: newId(MediaAssetId) }),
    ).toMatch(/Take/)
  })
})
