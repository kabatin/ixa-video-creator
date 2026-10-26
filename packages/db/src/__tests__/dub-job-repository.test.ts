import { describe, expect, it } from 'vitest'
import { CharacterId, DubJobId, ProjectId, ShotId, TakeId, VoiceProfileId, WorkspaceId, newId } from '@ixa/domain'
import { characterRowToDomain, type CharacterRow } from '../repositories/character-repository.js'
import { dubJobRowToDomain, type DubJobRow } from '../repositories/dub-job-repository.js'
import { voiceProfileRowToDomain, type VoiceProfileRow } from '../repositories/voice-profile-repository.js'

/** 実 DB には接続しない。row → Domain の変換と、壊れた行を黙って読み替えないことを確かめる。 */

const baseRow = (): DubJobRow => ({
  id: newId(DubJobId),
  projectId: newId(ProjectId),
  shotId: newId(ShotId),
  sourceTakeId: newId(TakeId),
  status: 'queued',
  takeId: null,
  costUsd: 0,
  error: null,
  record: null,
  queuedAt: new Date('2026-10-26T00:00:00.000Z'),
  startedAt: null,
  finishedAt: null,
})

describe('dubJobRowToDomain', () => {
  it('元の Take と状態を行から読む', () => {
    const row = baseRow()
    expect(dubJobRowToDomain(row)).toMatchObject({ sourceTakeId: row.sourceTakeId, status: 'queued', record: null })
  })

  it('成功したのに Take が無い行は読み替えずに投げる', () => {
    expect(() => dubJobRowToDomain({ ...baseRow(), status: 'succeeded' })).toThrow(/壊れています/)
  })

  it('失敗の理由と行の区間の案を読む', () => {
    const error = {
      code: 'lines_unassigned',
      message: '行の区間が決まりません',
      retryable: false,
      suggestedSpans: [{ lineIndex: 0, startSec: 0.2, endSec: 1.1 }],
    }
    expect(dubJobRowToDomain({ ...baseRow(), status: 'failed', error }).error).toEqual(error)
  })
})

describe('セリフの声と作った声の列', () => {
  it('キャラクターのセリフの声と距離を読む', () => {
    const voice = newId(VoiceProfileId)
    const row = {
      id: newId(CharacterId),
      workspaceId: newId(WorkspaceId),
      projectId: newId(ProjectId),
      name: 'neko',
      displayName: 'ネコ',
      description: '',
      identityAnchors: [],
      styleTokens: [],
      colorPalette: [],
      speakerNo: 1,
      speechName: null,
      voiceDescription: null,
      dialogueVoiceProfileId: voice,
      dialogueLevelDb: -9.5,
      createdAt: new Date(),
      deletedAt: null,
    } satisfies CharacterRow
    expect(characterRowToDomain(row)).toMatchObject({ dialogueVoiceProfileId: voice, dialogueLevelDb: -9.5 })
  })

  it('作った声の名札を読む。壊れた名札は黙って読み替えない', () => {
    const row = {
      id: newId(VoiceProfileId),
      projectId: newId(ProjectId),
      name: 'ネコの声',
      tool: 'gemini_api',
      model: 'gemini-3.8-flash-tts',
      voiceName: 'voice_abc',
      styleNote: '',
      speed: 1,
      volume: 1,
      language: 'ja',
      tuning: {},
      textStyleId: null,
      characterId: null,
      designedVoice: { description: 'やわらかい声', gender: 'female', keyLabel: 'key2-2026-10-14' },
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } satisfies VoiceProfileRow
    expect(voiceProfileRowToDomain(row).designedVoice?.keyLabel).toBe('key2-2026-10-14')
    expect(() =>
      voiceProfileRowToDomain({ ...row, designedVoice: { description: 'x', gender: 'female', keyLabel: '' } }),
    ).toThrow()
  })
})
