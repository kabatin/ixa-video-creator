import { describe, expect, it } from 'vitest'
import { aShot } from '@ixa/generation/testing'
import { assistContext, type AssistMaterials } from '../routes/assist-context.js'
import { aProject } from './fixtures.js'

/**
 * 「✦ AI」に渡す材料（ADR-0032 の 3 段目）。欄ごとに、案を出すのに要るものだけを渡す。
 * 空の材料はプロンプト側で落とす（ここでは空でも並べてよい）。
 */

const project = {
  ...aProject(),
  styleGuide: '35mm フィルム',
  avoid: '文字',
  lyrics: '一行目\n二行目',
  lyricCues: [1, 5],
  durationSec: 15,
}
const shots = [
  aShot(project.id, { code: 'CUT-01', order: 1000, startSec: 0, durationSec: 3, description: '屋上の扉' }),
  aShot(project.id, { code: 'CUT-02', order: 2000, startSec: 3, durationSec: 4, description: '', mood: '静か' }),
  aShot(project.id, { code: 'CUT-03', order: 3000, startSec: 7, durationSec: 3, description: '朝日' }),
]

const materials = (overrides: Partial<AssistMaterials> = {}): AssistMaterials => ({
  project,
  concept: '夜明けの屋上で二人が出会う',
  shots,
  shot: null,
  character: null,
  look: null,
  location: null,
  ...overrides,
})

const asMap = (lines: readonly { label: string; text: string }[]) =>
  Object.fromEntries(lines.map((line) => [line.label, line.text]))

describe('assistContext', () => {
  it('ナレーションの原稿は、作品の長さ（目安の字数）と、Shot の説明の流れを渡す（ADR-0038）', () => {
    const narration = asMap(assistContext('narration_script', materials()))
    expect(narration['作品の長さ']).toBe('15 秒（読み上げて 90 字ほど）')
    expect(narration['Shot の流れ']).toBe('CUT-01: 屋上の扉 / CUT-03: 朝日')
    expect(narration['コンセプト・あらすじ']).toBe('夜明けの屋上で二人が出会う')
    expect(asMap(assistContext('narration_script', materials({ project: { ...project, durationSec: null } })))['作品の長さ']).toBe('')
  })

  it('作品の欄は、作品名・方針・歌詞を渡す（自分の欄は渡さない）', () => {
    const look = asMap(assistContext('look', materials()))
    expect(look['コンセプト・あらすじ']).toBe('夜明けの屋上で二人が出会う')
    expect(look['歌詞']).toBe('一行目\n二行目')
    expect(look['ルック']).toBeUndefined()
    expect(asMap(assistContext('concept', materials()))['コンセプト・あらすじ']).toBeUndefined()
  })

  it('Shot の説明は、その Shot の時間・歌われる歌詞・雰囲気と、前後の Shot の説明を渡す', () => {
    const lines = asMap(assistContext('shot_description', materials({ shot: shots[1] ?? null })))
    expect(lines['この Shot']).toContain('CUT-02')
    expect(lines['この Shot で歌われる歌詞']).toBe('「二行目」')
    expect(lines['この Shot の雰囲気']).toBe('静か')
    expect(lines['前の Shot の説明']).toBe('屋上の扉')
    expect(lines['次の Shot の説明']).toBe('朝日')
  })

  it('雰囲気は、その Shot の説明を材料にする', () => {
    const lines = asMap(assistContext('shot_mood', materials({ shot: shots[0] ?? null })))
    expect(lines['この Shot の説明']).toBe('屋上の扉')
  })

  it('衣装は、人物と Look を材料にする', () => {
    const lines = asMap(
      assistContext(
        'wardrobe',
        materials({
          character: { displayName: 'ミナ', description: 'バリスタ', identityAnchors: ['短い黒髪', '丸眼鏡'] },
          look: { name: '仕事帰り', era: null, description: '雨の夜', wardrobeTokens: [] },
        }),
      ),
    )
    expect(lines['人物']).toBe('ミナ')
    expect(lines['識別アンカー']).toBe('短い黒髪、丸眼鏡')
    expect(lines['Look']).toBe('仕事帰り')
    expect(lines['Look の説明']).toBe('雨の夜')
  })
})
