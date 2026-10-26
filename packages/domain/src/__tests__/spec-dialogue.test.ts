import { describe, expect, it } from 'vitest'
import {
  CharacterId, CharacterLookId, ProjectId, ShotId, WorkspaceId,
} from '../common/ids.js'
import type { Character, CharacterLook } from '../character/character.js'
import type { CharacterBundle } from '../generation/reference-resolver.js'
import { compileSpec, computeSpecHash, type CompileInput } from '../generation/spec-compiler.js'
import {
  DialogueSpeakerError,
  compileSpecDialogue,
  dialogueSpeakerProblems,
  speakerTagOf,
} from '../generation/spec-dialogue.js'
import { ShotGenerationSpec } from '../generation/spec.js'
import { compileStartFramePrompt } from '../generation/start-frame-prompt.js'
import type { DialogueLine } from '../shot/dialogue.js'
import type { Shot } from '../shot/shot.js'

const CAT_ID = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
const MOUSE_ID = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB2')

const character = (overrides: Partial<Character> = {}): Character => ({
  id: CAT_ID,
  workspaceId: WorkspaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1'),
  projectId: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  name: 'neko',
  displayName: 'ネコ',
  description: '',
  identityAnchors: [],
  styleTokens: [],
  colorPalette: [],
  speakerNo: 2,
  speechName: 'The cat',
  voiceDescription: "a soft, sly, teasing young woman's voice",
  createdAt: new Date(0),
  ...overrides,
})

const CAT = character()
const MOUSE = character({
  id: MOUSE_ID, name: 'nezumi', displayName: 'ネズミ', speakerNo: 1,
  speechName: 'The mouse', voiceDescription: 'a small, nervous boy\'s voice',
})

const look = (characterId: CharacterId): CharacterLook => ({
  id: CharacterLookId.parse(characterId === CAT_ID ? '01ARZ3NDEKTSV4RRFFQ69G5FD1' : '01ARZ3NDEKTSV4RRFFQ69G5FD2'),
  characterId,
  key: 'BASE',
  name: '基本',
  era: null,
  description: '',
  wardrobeTokens: [],
  styleTokens: [],
  colorPalette: [],
  isDefault: true,
  canonicalFrameAssetId: null,
})

const bundle = (c: Character): CharacterBundle => ({
  character: c, look: look(c.id), identityImages: [], lookImages: [],
})

const line = (overrides: Partial<DialogueLine> = {}): DialogueLine => ({
  speakerId: CAT_ID, text: 'ねえ、ネズミくん。', offscreen: false, translation: null, ...overrides,
})

const shot = (overrides: Partial<Shot> = {}): Shot => ({
  id: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  projectId: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  sequenceId: null,
  locationId: null,
  order: 1000,
  code: 'shot_014',
  startSec: 51.2,
  durationSec: 3.75,
  sourceInSec: 0,
  timing: 'trim',
  speed: 1,
  takeAudioVolume: 1,
  takeAudioMuted: false,
  description: 'iXA CUP 決勝で takepi が勝利する',
  dialogue: [],
  camera: {
    size: 'medium_closeup', angleH: 'front_left', angle: 'low',
    lensMm: 50, movement: 'push_in', movementIntensity: 'subtle',
  },
  mood: '緊迫',
  continuityMode: 'independent',
  sourceType: { type: 'ai_video' },
  selectedTakeId: null,
  status: 'ready',
  lockedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const input = (overrides: Partial<CompileInput> = {}): CompileInput => ({
  project: {
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    styleGuide: '和テイスト、墨、フィルムグレイン',
  },
  shot: shot(),
  characters: [],
  references: [],
  generationDurationSec: 4,
  seed: null,
  negativePrompt: null,
  ...overrides,
})

describe('speakerTagOf', () => {
  it('話し手の番号を S1, S2… にする', () => {
    expect(speakerTagOf(1)).toBe('S1')
    expect(speakerTagOf(12)).toBe('S12')
  })
})

describe('dialogueSpeakerProblems', () => {
  it('呼び名と声の説明がそろっていれば問題なし', () => {
    expect(dialogueSpeakerProblems([line()], [CAT])).toEqual([])
  })

  it('呼び名・声の説明が無い話し手を、名前を添えて挙げる（同じ人は 1 回だけ）', () => {
    const bare = character({ speechName: null, voiceDescription: '  ' })
    expect(dialogueSpeakerProblems([line(), line()], [bare])).toEqual([
      'セリフの話し手「ネコ」に英語の呼び名がありません',
      'セリフの話し手「ネコ」に声の説明（英語）がありません',
    ])
  })

  it('話し手が見つからなければそう言う（消したキャラクター）', () => {
    expect(dialogueSpeakerProblems([line({ speakerId: MOUSE_ID })], [CAT])).toEqual([
      'セリフの話し手が見つかりません（消したキャラクターかもしれません）',
    ])
  })
})

describe('compileSpecDialogue', () => {
  it('行が無ければ null（仕様にキーを置かない）', () => {
    expect(compileSpecDialogue({ lines: [], speakers: [], onScreen: [] })).toBeNull()
  })

  it('話し手の番号・呼び名・声の説明を一字一句そのまま入れ、映っている人の一覧を添える', () => {
    expect(
      compileSpecDialogue({
        lines: [line(), line({ speakerId: MOUSE_ID, text: 'なに？', offscreen: true })],
        speakers: [CAT, MOUSE],
        onScreen: [CAT],
      }),
    ).toEqual({
      lines: [
        { speakerTag: 'S2', speechName: 'The cat', voiceDescription: "a soft, sly, teasing young woman's voice", text: 'ねえ、ネズミくん。', offscreen: false },
        { speakerTag: 'S1', speechName: 'The mouse', voiceDescription: "a small, nervous boy's voice", text: 'なに？', offscreen: true },
      ],
      onScreen: [{ speakerTag: 'S2', speechName: 'The cat' }],
    })
  })

  it('映っていても呼び名の無い人は一覧に入れない（名指しできない）', () => {
    const bystander = character({ id: MOUSE_ID, speakerNo: 3, speechName: null })
    const result = compileSpecDialogue({ lines: [line()], speakers: [CAT], onScreen: [CAT, bystander] })
    expect(result?.onScreen).toEqual([{ speakerTag: 'S2', speechName: 'The cat' }])
  })

  it('話し手がそろっていなければ、理由をすべて持って止める', () => {
    const run = () => compileSpecDialogue({ lines: [line()], speakers: [character({ speechName: null })], onScreen: [] })
    expect(run).toThrow(DialogueSpeakerError)
    expect(run).toThrow('セリフの話し手「ネコ」に英語の呼び名がありません')
  })
})

describe('compileSpec とセリフ', () => {
  /** `spec-compiler.test.ts` の BASELINE と同じ値。セリフの欄を足しても、無い Shot のハッシュは動かない。 */
  const BASELINE = 'e8b6c5465b3defaf21459e406df0a89273f5c4f7bec2234ed1bedb7cbf106532'

  it('セリフが無ければ仕様のハッシュは今までと同じ（話し手を渡していても）', async () => {
    const spec = compileSpec(input({ speakers: [CAT] }))
    expect('dialogue' in spec.promptParts).toBe(false)
    expect(await computeSpecHash(spec)).toBe(BASELINE)
  })

  it('セリフのある Shot だけ promptParts.dialogue を持つ。映っているのは配役の人', () => {
    const spec = compileSpec(input({
      shot: shot({ dialogue: [line()] }),
      characters: [bundle(CAT), bundle(MOUSE)],
      speakers: [CAT],
    }))
    expect(spec.promptParts.dialogue).toEqual({
      lines: [{ speakerTag: 'S2', speechName: 'The cat', voiceDescription: "a soft, sly, teasing young woman's voice", text: 'ねえ、ネズミくん。', offscreen: false }],
      onScreen: [
        { speakerTag: 'S2', speechName: 'The cat' },
        { speakerTag: 'S1', speechName: 'The mouse' },
      ],
    })
    // 仕様として読み直しても落ちない（Take に保存して読む）
    expect(ShotGenerationSpec.parse(spec).promptParts.dialogue).toEqual(spec.promptParts.dialogue)
  })

  it('セリフがあるとハッシュが変わる', async () => {
    const plain = await computeSpecHash(compileSpec(input()))
    const spoken = await computeSpecHash(compileSpec(input({ shot: shot({ dialogue: [line()] }), speakers: [CAT] })))
    expect(spoken).not.toBe(plain)
  })

  it('話し手を渡さなければ止める', () => {
    expect(() => compileSpec(input({ shot: shot({ dialogue: [line()] }) }))).toThrow(DialogueSpeakerError)
  })

  it('最初のコマの指示文はセリフを見ない（話し手がそろっていなくても作れる）', () => {
    expect(() =>
      compileStartFramePrompt({
        project: { ...input().project, avoid: '' },
        shot: shot({ dialogue: [line()] }),
        characters: [],
        references: [],
      }),
    ).not.toThrow()
  })
})
