import { describe, expect, it } from 'vitest'
import { Character, UpdateCharacterPatch } from '../character/character.js'
import { assignLines } from '../dub/assign-lines.js'
import {
  DUB_ALL_KEPT_REASON,
  DUB_GENERATING_REASON,
  DUB_IN_PROGRESS_REASON,
  DUB_NO_AUDIO_REASON,
  DUB_NO_DIALOGUE_REASON,
  DUB_NO_TAKE_REASON,
  DubJobError,
  dubBlocker,
  dubJobViolation,
  dubRecordOf,
} from '../dub/dub-job.js'
import { DesignedVoice, VoiceProfile } from '../narration/voice-profile.js'

const c = (startSec: number, endSec: number) => ({ startSec, endSec })
const TAKE = '01J0000000000000000000TAKE'

describe('assignLines の手の区間の案', () => {
  it('まとまった区間を、行の文字数の比で割った案を付けて止める', () => {
    const result = assignLines([c(0.2, 2.0)], [{ text: 'あいう' }, { text: 'えおかきくけこさし' }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.suggestions).toEqual([
      { lineIndex: 0, startSec: 0.2, endSec: 0.65 },
      { lineIndex: 1, startSec: 0.65, endSec: 2 },
    ])
  })

  it('声の区間が 1 つも無ければ案は出さない', () => {
    const result = assignLines([], [{ text: 'あ' }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.suggestions).toEqual([])
  })

  it('手の区間の行と足す行は案に入らない', () => {
    const result = assignLines(
      [c(0.2, 1.0), c(1.5, 3.0)],
      [{ text: 'あ', dub: { startSec: 0.2, endSec: 1.0 } }, { text: 'いい' }, { text: 'う', dub: { added: true, placeAtSec: 2 } }, { text: 'ええ' }],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.suggestions.map((s) => s.lineIndex)).toEqual([1, 3])
  })
})

describe('dubBlocker', () => {
  const shot = { status: 'selected', selectedTakeId: TAKE, dialogue: [{}] }
  it('差し替えられる Shot は null', () => {
    expect(dubBlocker({ shot, sourceHasAudio: true, active: false })).toBeNull()
    expect(dubBlocker({ shot, sourceHasAudio: null, active: false })).toBeNull()
  })
  it('理由を順に言う', () => {
    expect(dubBlocker({ shot: { ...shot, dialogue: [] }, sourceHasAudio: true, active: false })).toBe(DUB_NO_DIALOGUE_REASON)
    expect(dubBlocker({ shot: { ...shot, dialogue: [{ dub: { keepOriginal: true } }] }, sourceHasAudio: true, active: false })).toBe(
      DUB_ALL_KEPT_REASON,
    )
    expect(dubBlocker({ shot: { ...shot, status: 'generating' }, sourceHasAudio: true, active: false })).toBe(DUB_GENERATING_REASON)
    expect(dubBlocker({ shot, sourceHasAudio: true, active: true })).toBe(DUB_IN_PROGRESS_REASON)
    expect(dubBlocker({ shot: { ...shot, selectedTakeId: null }, sourceHasAudio: true, active: false })).toBe(DUB_NO_TAKE_REASON)
    expect(dubBlocker({ shot, sourceHasAudio: false, active: false })).toBe(DUB_NO_AUDIO_REASON)
  })
})

describe('dubJobViolation', () => {
  const record = { kind: 'dub' as const, sourceTakeId: TAKE, voiceTool: 'gemini_api' as const, model: 'm', integratedLufs: -16, lines: [] }
  it('状態と中身の食い違いを止める', () => {
    expect(dubJobViolation({ status: 'succeeded', takeId: null, error: null, record: null })).not.toBeNull()
    expect(dubJobViolation({ status: 'failed', takeId: null, error: null, record: null })).not.toBeNull()
    expect(dubJobViolation({ status: 'queued', takeId: null, error: { code: 'x', message: 'y', retryable: false }, record: null })).not.toBeNull()
    expect(dubJobViolation({ status: 'succeeded', takeId: TAKE as never, error: null, record: record as never })).toBeNull()
  })
  it('失敗の理由の案は区間が正しいものだけ', () => {
    const base = { code: 'lines_unassigned', message: 'm', retryable: false }
    expect(DubJobError.safeParse({ ...base, suggestedSpans: [{ lineIndex: 0, startSec: 1, endSec: 2 }] }).success).toBe(true)
    expect(DubJobError.safeParse({ ...base, suggestedSpans: [{ lineIndex: 0, startSec: 2, endSec: 1 }] }).success).toBe(false)
    expect(DubJobError.safeParse({ ...base, suggestedSpans: [{ lineIndex: 20, startSec: 1, endSec: 2 }] }).success).toBe(false)
    expect(DubJobError.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
  it('dubRecordOf は差し替えた Take の記録だけを返す', () => {
    expect(dubRecordOf({ providerParams: record })).toEqual(record)
    expect(dubRecordOf({ providerParams: { kind: 'http' } })).toBeNull()
  })
})

describe('キャラクターのセリフの声と距離', () => {
  it('距離は -40〜12 dB。外れた値は弾く', () => {
    expect(UpdateCharacterPatch.safeParse({ dialogueLevelDb: -9.5 }).success).toBe(true)
    expect(UpdateCharacterPatch.safeParse({ dialogueLevelDb: -40.1 }).success).toBe(false)
    expect(UpdateCharacterPatch.safeParse({ dialogueLevelDb: 12.1 }).success).toBe(false)
    expect(UpdateCharacterPatch.safeParse({ dialogueLevelDb: Number.NaN }).success).toBe(false)
    expect(UpdateCharacterPatch.safeParse({ dialogueVoiceProfileId: 'not-ulid' }).success).toBe(false)
    expect(UpdateCharacterPatch.safeParse({ dialogueVoiceProfileId: null }).success).toBe(true)
  })
  it('前からの行は「未設定・0 dB」で読める', () => {
    const character = Character.parse({
      id: '01J0000000000000000000CHAR',
      workspaceId: '01J00000000000000000000WSP',
      projectId: '01J00000000000000000000PRJ',
      name: 'a',
      displayName: 'a',
      speakerNo: 1,
      createdAt: new Date(),
    })
    expect(character.dialogueVoiceProfileId).toBeNull()
    expect(character.dialogueLevelDb).toBe(0)
  })
})

describe('作った声', () => {
  const ok = { description: '落ち着いた老紳士', gender: 'male', keyLabel: 'key2-2026-10-14' }
  it('説明・性別・鍵の名札を持つ。鍵の名札は英数字と . _ - だけ', () => {
    expect(DesignedVoice.safeParse(ok).success).toBe(true)
    expect(DesignedVoice.safeParse({ ...ok, keyLabel: 'AIza secret key' }).success).toBe(false)
    expect(DesignedVoice.safeParse({ ...ok, keyLabel: 'x'.repeat(65) }).success).toBe(false)
    expect(DesignedVoice.safeParse({ ...ok, gender: 'other' }).success).toBe(false)
    expect(DesignedVoice.safeParse({ ...ok, description: 'あ'.repeat(1001) }).success).toBe(false)
    expect(DesignedVoice.safeParse({ ...ok, extra: 1 }).success).toBe(false)
  })
  it('前からの声は designedVoice が null で読める', () => {
    const voice = VoiceProfile.parse({
      id: '01J0000000000000000000VCE1',
      projectId: '01J00000000000000000000PRJ',
      name: 'n',
      tool: 'gemini_api',
      model: null,
      voiceName: 'Kore',
      styleNote: '',
      speed: 1,
      volume: 1,
      language: 'ja',
      tuning: {},
      textStyleId: null,
      characterId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(voice.designedVoice).toBeNull()
  })
})
