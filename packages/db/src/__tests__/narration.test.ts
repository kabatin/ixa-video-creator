import {
  MediaAssetId,
  NarrationLineId,
  NarrationTakeId,
  ProjectId,
  VoiceJobId,
  VoiceProfileId,
  newId,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { narrationLineRowToDomain, type NarrationLineRow } from '../repositories/narration-line-repository.js'
import { narrationTakeRowToDomain, type NarrationTakeRow } from '../repositories/narration-take-repository.js'
import { audioSettingsRowToDomain, type ProjectAudioSettingsRow } from '../repositories/project-audio-settings-repository.js'
import { voiceJobRowToDomain, type VoiceJobRow } from '../repositories/voice-job-repository.js'
import { voiceProfileRowToDomain, type VoiceProfileRow } from '../repositories/voice-profile-repository.js'

/** ナレーションと声（ADR-0038）の行 → Domain。壊れた行を黙って読み替えないことを確かめる。 */

const NOW = new Date('2026-10-05T00:00:00Z')
const PROJECT = newId(ProjectId)

describe('voice_profiles', () => {
  const row: VoiceProfileRow = {
    id: newId(VoiceProfileId),
    projectId: PROJECT,
    name: 'ナレーター',
    tool: 'gemini_api',
    model: 'gemini-3.8-flash-tts',
    voiceName: 'Kore',
    styleNote: '低めの声',
    speed: 1,
    volume: 1,
    language: 'ja',
    tuning: {},
    textStyleId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  }

  it('行を声にする（消した印は Domain に出さない）', () => {
    const voice = voiceProfileRowToDomain(row)
    expect(voice).toMatchObject({ name: 'ナレーター', tool: 'gemini_api', voiceName: 'Kore' })
    expect(voice).not.toHaveProperty('deletedAt')
  })

  it('知らない AI の名前が入っていれば、黙って読み替えず失敗する', () => {
    expect(() => voiceProfileRowToDomain({ ...row, tool: 'gemini_cli' as VoiceProfileRow['tool'] })).toThrow()
  })
})

describe('narration_lines', () => {
  it('行を原稿の行にする', () => {
    const row: NarrationLineRow = {
      id: newId(NarrationLineId),
      projectId: PROJECT,
      order: 3,
      text: '進め。',
      reading: null,
      voiceProfileId: null,
      direction: '',
      startSec: 1.5,
      selectedTakeId: null,
      telop: true,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }
    expect(narrationLineRowToDomain(row)).toMatchObject({ order: 3, text: '進め。', startSec: 1.5 })
  })
})

describe('narration_takes', () => {
  const row: NarrationTakeRow = {
    id: newId(NarrationTakeId),
    lineId: newId(NarrationLineId),
    index: 2,
    source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'macos_say', model: null, voiceName: 'Kyoko' },
    mediaAssetId: newId(MediaAssetId),
    inSec: 0,
    outSec: 1.2,
    spokenText: 'すすめ',
    displayText: '進め',
    specHash: 'abc',
    charTimes: null,
    loudnessLufs: -16,
    peaks: [0.1, 0.5],
    costUsd: 0,
    createdAt: NOW,
  }

  it('行を声の Take にする', () => {
    expect(narrationTakeRowToDomain(row)).toMatchObject({ index: 2, outSec: 1.2, peaks: [0.1, 0.5] })
  })

  it('区間が壊れた行は失敗する', () => {
    expect(() => narrationTakeRowToDomain({ ...row, outSec: 0 })).toThrow()
  })
})

describe('voice_jobs', () => {
  const row: VoiceJobRow = {
    id: newId(VoiceJobId),
    projectId: PROJECT,
    kind: 'transcribe',
    lineId: null,
    takeId: null,
    voiceProfileId: null,
    inputMediaAssetId: newId(MediaAssetId),
    resultMediaAssetId: null,
    placeAtSec: 0,
    tool: 'whisper_cpp',
    model: null,
    spec: null,
    status: 'queued',
    costUsd: null,
    error: null,
    providerRecord: null,
    queuedAt: NOW,
    startedAt: null,
    finishedAt: null,
  }

  it('行をジョブにする', () => {
    expect(voiceJobRowToDomain(row)).toMatchObject({ kind: 'transcribe', status: 'queued', tool: 'whisper_cpp' })
  })

  it('種類に要るものが無い行は、壊れていると言って失敗する', () => {
    expect(() => voiceJobRowToDomain({ ...row, inputMediaAssetId: null })).toThrow(/声のジョブ .* の記録が壊れています/)
  })
})

describe('project_audio_settings', () => {
  it('行を作品の音の設定にする', () => {
    const row: ProjectAudioSettingsRow = {
      projectId: PROJECT,
      readingDictionary: [{ written: '戦子', reading: 'せんこ' }],
      ducking: { enabled: false, depthDb: 6, attackSec: 0.1, releaseSec: 0.3 },
      telopHighlight: { enabled: true, color: '#ff0000' },
      updatedAt: NOW,
    }
    expect(audioSettingsRowToDomain(row)).toEqual({
      projectId: PROJECT,
      readingDictionary: [{ written: '戦子', reading: 'せんこ' }],
      ducking: { enabled: false, depthDb: 6, attackSec: 0.1, releaseSec: 0.3 },
      telopHighlight: { enabled: true, color: '#ff0000' },
    })
  })
})
