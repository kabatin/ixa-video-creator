import { describe, expect, it } from 'vitest'
import {
  CharacterId,
  MediaAssetId,
  MusicAnalysisId,
  MusicTrackId,
  ProjectId,
  SfxJobId,
  TextStyleId,
  VoiceProfileId,
  newId,
} from '../common/ids.js'
import { MusicAnalysis, MusicTrack } from '../music/music.js'
import { VOICE_NAME_MAX, VoiceProfile } from '../narration/voice-profile.js'
import {
  SFX_IMPORTED_FROM_KEY,
  copyMusicAnalysisInput,
  importMusicTrackInput,
  importSfxSoundInput,
  importVoiceInput,
  unusedName,
} from '../project/library-import.js'
import { SFX_SEEDS_USED_KEY, SfxJob, sfxSeedsUsedOf } from '../sfx/sfx-job.js'

/**
 * ほかの作品から声・楽曲・効果音を取り込む規則（ADR-0053。制作者 2026-10-19「素材ツリーにある各種項目の素材を
 * 他のプロジェクトから簡単にコピーできるといいなぁ。現にいま、戦子ちゃんにある声素材が欲しいと思ってしまった」）。
 * 設定は複製し、音のファイルは同じものを指す。複製した後は別物。
 */

const SOURCE_PROJECT = newId(ProjectId)
const TARGET_PROJECT = newId(ProjectId)
const AT = new Date('2026-10-19T00:00:00.000Z')

describe('unusedName', () => {
  it('ぶつからなければそのまま', () => {
    expect(unusedName('戦子', ['ナレーター'], VOICE_NAME_MAX)).toBe('戦子')
  })

  it('ぶつかれば（2）（3）…と空いている番号を付ける', () => {
    expect(unusedName('戦子', ['戦子'], VOICE_NAME_MAX)).toBe('戦子（2）')
    expect(unusedName('戦子', ['戦子', '戦子（2）'], VOICE_NAME_MAX)).toBe('戦子（3）')
  })

  it('前後の空白は無いものとして比べる（保存するときに落ちるため）', () => {
    expect(unusedName(' 戦子 ', ['戦子'], VOICE_NAME_MAX)).toBe('戦子（2）')
  })

  it('番号を付けても上限の文字数に収める', () => {
    const long = 'あ'.repeat(VOICE_NAME_MAX)
    const named = unusedName(long, [long], VOICE_NAME_MAX)
    expect(named.length).toBe(VOICE_NAME_MAX)
    expect(named.endsWith('（2）')).toBe(true)
  })
})

describe('importVoiceInput', () => {
  const SOURCE_CHARACTER = newId(CharacterId)
  const aVoice = (patch: Partial<VoiceProfile> = {}): VoiceProfile =>
    VoiceProfile.parse({
      id: newId(VoiceProfileId),
      projectId: SOURCE_PROJECT,
      name: '戦子',
      tool: 'gemini_api',
      model: 'gemini-3.8-flash-tts',
      voiceName: 'Kore',
      styleNote: '元気な少女の声',
      speed: 1.1,
      volume: 0.9,
      language: 'ja',
      tuning: {},
      textStyleId: newId(TextStyleId),
      characterId: SOURCE_CHARACTER,
      createdAt: AT,
      updatedAt: AT,
      ...patch,
    })

  it('声の設定を取り込み先の作品へ写す（テロップの見た目は作品ごとなので外す）', () => {
    expect(importVoiceInput(aVoice(), { projectId: TARGET_PROJECT, characters: new Map(), takenNames: [] })).toEqual({
      projectId: TARGET_PROJECT,
      name: '戦子',
      tool: 'gemini_api',
      model: 'gemini-3.8-flash-tts',
      voiceName: 'Kore',
      styleNote: '元気な少女の声',
      speed: 1.1,
      volume: 0.9,
      language: 'ja',
      tuning: {},
      textStyleId: null,
      characterId: null,
    })
  })

  it('同じ取り込みでキャラクターも写したなら、写した方のキャラクターの声にする', () => {
    const copied = newId(CharacterId)
    const input = importVoiceInput(aVoice(), {
      projectId: TARGET_PROJECT,
      characters: new Map([[SOURCE_CHARACTER, copied]]),
      takenNames: [],
    })
    expect(input.characterId).toBe(copied)
  })

  it('取り込み先に同じ名前の声があれば名前をずらす', () => {
    const input = importVoiceInput(aVoice(), { projectId: TARGET_PROJECT, characters: new Map(), takenNames: ['戦子'] })
    expect(input.name).toBe('戦子（2）')
  })
})

describe('importMusicTrackInput', () => {
  const aTrack = (patch: Partial<MusicTrack> = {}): MusicTrack =>
    MusicTrack.parse({
      id: newId(MusicTrackId),
      projectId: SOURCE_PROJECT,
      mediaAssetId: newId(MediaAssetId),
      title: '進め！戦子ちゃん！',
      isMaster: true,
      offsetSec: 1.5,
      volume: 0.8,
      fadeInSec: 0.5,
      fadeOutSec: 2,
      endSec: 95.25,
      ...patch,
    })

  it('同じ音を指し、調整（位置・音量・フェード・曲の終わり）を写す。マスターにはしない', () => {
    const track = aTrack()
    expect(importMusicTrackInput(track, TARGET_PROJECT)).toEqual({
      projectId: TARGET_PROJECT,
      mediaAssetId: track.mediaAssetId,
      title: '進め！戦子ちゃん！',
      isMaster: false,
      offsetSec: 1.5,
      volume: 0.8,
      fadeInSec: 0.5,
      fadeOutSec: 2,
      endSec: 95.25,
    })
  })

  it('フェード・曲の終わりが無い曲は無いまま写す', () => {
    const track = aTrack({ fadeInSec: undefined, fadeOutSec: undefined, endSec: null })
    expect(importMusicTrackInput(track, TARGET_PROJECT)).toMatchObject({ fadeInSec: 0, fadeOutSec: 0, endSec: null })
  })
})

describe('copyMusicAnalysisInput', () => {
  it('解析を写した曲に付け替える（解析し直さない）', () => {
    const analysis = MusicAnalysis.parse({
      id: newId(MusicAnalysisId),
      musicTrackId: newId(MusicTrackId),
      analyzerVersion: 'manual',
      durationSec: 116,
      bpm: 128,
      bpmConfidence: 0.9,
      beats: [0.5, 0.97],
      downbeats: [0.5],
      sections: [{ start: 0, end: 116, label: 'intro', energy: 0.5 }],
      energyCurve: { hopSec: 0.5, values: [0.1] },
      onsets: [0.5],
      drops: [],
      waveformPeaksKey: 'peaks/a.json',
      createdAt: AT,
    })
    const to = newId(MusicTrackId)
    expect(copyMusicAnalysisInput(analysis, to)).toEqual({
      musicTrackId: to,
      analyzerVersion: 'manual',
      durationSec: 116,
      bpm: 128,
      bpmConfidence: 0.9,
      beats: [0.5, 0.97],
      downbeats: [0.5],
      sections: analysis.sections,
      energyCurve: analysis.energyCurve,
      onsets: [0.5],
      drops: [],
      waveformPeaksKey: 'peaks/a.json',
    })
  })
})

describe('importSfxSoundInput', () => {
  const first = newId(MediaAssetId)
  const second = newId(MediaAssetId)
  const aJob = (patch: Partial<SfxJob> = {}): SfxJob =>
    SfxJob.parse({
      id: newId(SfxJobId),
      projectId: SOURCE_PROJECT,
      tool: 'stable_audio',
      model: 'stable-audio-3',
      spec: { cue: { startSec: 3.75, durationSec: 1.5, prompt: 'sword clash', volume: 0.8 }, count: 2, seed: 10 },
      status: 'succeeded',
      error: null,
      providerRecord: { [SFX_SEEDS_USED_KEY]: [10, 12], job: 'abc' },
      mediaAssetIds: [first, second],
      timelineClipId: null,
      queuedAt: AT,
      startedAt: AT,
      finishedAt: AT,
      ...patch,
    })

  it('選んだ 1 本を、取り込み先の「置いていない候補」にする（同じ音を指し、その音の種を残す）', () => {
    const job = aJob()
    const input = importSfxSoundInput(job, second, TARGET_PROJECT)
    expect(input).toEqual({
      projectId: TARGET_PROJECT,
      tool: 'stable_audio',
      model: 'stable-audio-3',
      spec: { cue: job.spec.cue, count: 1, seed: 12 },
      mediaAssetIds: [second],
      providerRecord: {
        [SFX_SEEDS_USED_KEY]: [12],
        [SFX_IMPORTED_FROM_KEY]: { projectId: SOURCE_PROJECT, sfxJobId: job.id },
      },
    })
    // 取り込んだ音の種を、作った音と同じ読み方で読める。
    expect(sfxSeedsUsedOf({ providerRecord: input?.providerRecord ?? null, mediaAssetIds: [second] })).toEqual([12])
  })

  it('種が分からない音は種を null にする（黙って別の種を出さない）', () => {
    const input = importSfxSoundInput(aJob({ providerRecord: null }), first, TARGET_PROJECT)
    expect(input?.spec.seed).toBeNull()
    expect(input?.providerRecord[SFX_SEEDS_USED_KEY]).toEqual([null])
  })

  it('ジョブに無い音・できていないジョブの音は取り込めない', () => {
    expect(importSfxSoundInput(aJob(), newId(MediaAssetId), TARGET_PROJECT)).toBeNull()
    expect(importSfxSoundInput(aJob({ status: 'failed' }), first, TARGET_PROJECT)).toBeNull()
  })
})
