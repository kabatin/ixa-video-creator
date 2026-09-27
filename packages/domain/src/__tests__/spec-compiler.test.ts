import { describe, expect, it } from 'vitest'
import { ProjectId, ShotId } from '../common/ids.js'
import type { Shot } from '../shot/shot.js'
import { assemblePrompt, compileSpec, computeSpecHash } from '../generation/spec-compiler.js'
import type { CompileInput } from '../generation/spec-compiler.js'
import {
  Corrections,
  MAX_CORRECTION_LENGTH,
  MAX_CORRECTIONS,
  ShotGenerationSpec,
} from '../generation/spec.js'

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
  description: 'iXA CUP 決勝で takepi が勝利する',
  dialogue: null,
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

describe('compileSpec', () => {
  it('編集尺ではなく生成尺を仕様に入れる（ADR-0011）', () => {
    const spec = compileSpec(input())
    expect(spec.durationSec).toBe(4)      // 生成尺
    expect(shot().durationSec).toBe(3.75) // 編集尺は Shot 側に残る
  })

  it('プロジェクトの出力仕様をそのまま引き継ぐ', () => {
    const spec = compileSpec(input())
    expect(spec.aspectRatio).toBe('16:9')
    expect(spec.resolution).toEqual({ width: 1920, height: 1080 })
    expect(spec.fps).toBe(30)
  })

  it('カメラ指定がプロンプト断片に落ちる', () => {
    const spec = compileSpec(input())
    expect(spec.promptParts.cameraFragment).toContain('medium closeup')
    expect(spec.promptParts.cameraFragment).toContain('front left')
    expect(spec.promptParts.cameraFragment).toContain('push in')
  })

  it('promptParts に構成要素が残り、監査できる', () => {
    const spec = compileSpec(input())
    expect(spec.promptParts.styleGuide).toBe('和テイスト、墨、フィルムグレイン')
    expect(spec.promptParts.shotDescription).toContain('takepi')
    expect(spec.promptParts.moodFragment).toBe('緊迫')
  })

  it('sourceType の種別だけを持ち、判別共用体の中身は持ち込まない', () => {
    expect(compileSpec(input({ shot: shot({ sourceType: { type: 'ai_video' } }) })).sourceType)
      .toBe('ai_video')
  })
})

describe('assemblePrompt', () => {
  const parts = {
    styleGuide: 'スタイル',
    shotDescription: '説明',
    identityAnchors: ['細身', '鋭い目'],
    styleTokens: ['硬質な光'],
    colorPalette: ['#FFD200'],
    wardrobeTokens: ['ユニフォーム'],
    cameraFragment: 'medium closeup',
    moodFragment: '緊迫',
  }

  it('決まった順序で連結する（順序が変わると specHash が壊れる）', () => {
    const prompt = assemblePrompt(parts)
    expect(prompt.indexOf('説明')).toBeLessThan(prompt.indexOf('細身'))
    expect(prompt.indexOf('細身')).toBeLessThan(prompt.indexOf('ユニフォーム'))
    expect(prompt.indexOf('ユニフォーム')).toBeLessThan(prompt.indexOf('medium closeup'))
  })

  it('空の断片を落とす', () => {
    const prompt = assemblePrompt({ ...parts, styleGuide: '', moodFragment: null, colorPalette: [] })
    expect(prompt).not.toContain('..')
    expect(prompt).not.toContain('color palette')
  })
})

describe('computeSpecHash', () => {
  it('同じ仕様なら同じハッシュ', async () => {
    const a = await computeSpecHash(compileSpec(input()))
    const b = await computeSpecHash(compileSpec(input()))
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  it('尺が変われば別のハッシュ', async () => {
    const a = await computeSpecHash(compileSpec(input()))
    const b = await computeSpecHash(compileSpec(input({ generationDurationSec: 6 })))
    expect(a).not.toBe(b)
  })

  it('seed が変われば別のハッシュ', async () => {
    const a = await computeSpecHash(compileSpec(input({ seed: 1 })))
    const b = await computeSpecHash(compileSpec(input({ seed: 2 })))
    expect(a).not.toBe(b)
  })
})

/**
 * **仕様のハッシュは既存の Take の重複検知に使われている。**
 *
 * 仕様に新しい欄を足すと `canonicalJson` の文字列が変わり、
 * 既に生成済みの Take とハッシュが一致しなくなる。すると
 * 「同じ内容なのに別物」と判定され、重複検知が黙って効かなくなる。
 * 効かなくなったことは画面からは見えず、費用としてだけ現れる。
 *
 * この値は 2026-09-18（PHASE 6.1 の着手前）に採取したもの。
 * **欄を足してここが落ちたら、その欄は `undefined` のときキーごと消えていない。**
 * `canonicalJson` は `JSON.stringify` なので、キーが無ければ文字列にも現れない。
 */
describe('仕様のハッシュ（既存の Take との互換）', () => {
  const BASELINE = 'e8b6c5465b3defaf21459e406df0a89273f5c4f7bec2234ed1bedb7cbf106532'

  it('同じ入力から同じハッシュが出る（記録した値と一致する）', async () => {
    expect(await computeSpecHash(compileSpec(input()))).toBe(BASELINE)
  })
})

/**
 * レビューの指摘から人が選んだ直し（PHASE 6.1）。
 *
 * ここが守るのは 2 つ。**差分が無いときは何も変わらない**ことと、
 * **差分があるときは必ず別のハッシュになる**こと。
 * 後者が崩れると、直した再生成が「同じ仕様の Take が既にある」と判定され、
 * せっかくの直しが重複として扱われる。
 */
describe('corrections（指摘→再生成の差分）', () => {
  it('差分が無いときは仕様にキーごと現れない', () => {
    expect('corrections' in compileSpec(input())).toBe(false)
    expect('corrections' in compileSpec(input({ corrections: [] }))).toBe(false)
    // 空白だけの要素は差分ではない。キーを置かせない。
    expect('corrections' in compileSpec(input({ corrections: ['  ', '\n'] }))).toBe(false)
  })

  it('差分があるときは仕様に載り、trim される', () => {
    const spec = compileSpec(input({ corrections: ['  顔をもっと近く  ', '光を強く'] }))
    expect(spec.corrections).toEqual(['顔をもっと近く', '光を強く'])
  })

  it('差分を最終プロンプトの末尾へ連結する（promptParts だけでは provider に届かない）', () => {
    const base = compileSpec(input())
    const spec = compileSpec(input({ corrections: ['顔をもっと近く'] }))

    expect(spec.prompt).toContain('顔をもっと近く')
    // 既存の断片の順序は動かさない。差分は必ず後ろ。
    expect(spec.prompt.startsWith(base.prompt)).toBe(true)
    expect(spec.prompt.indexOf('顔をもっと近く')).toBeGreaterThan(base.prompt.length - 1)
  })

  it('差分は promptParts を汚さない（監査の断片は組み立てのままにする）', () => {
    const base = compileSpec(input())
    const spec = compileSpec(input({ corrections: ['顔をもっと近く'] }))
    expect(spec.promptParts).toEqual(base.promptParts)
  })

  it('差分なしのハッシュは差分の口を足す前と同じ', async () => {
    const before = await computeSpecHash(compileSpec(input()))
    const after = await computeSpecHash(compileSpec(input({ corrections: [] })))
    expect(after).toBe(before)
  })

  it('差分ありは必ず別のハッシュ（でないと再生成が重複として捨てられる）', async () => {
    const plain = await computeSpecHash(compileSpec(input()))
    const corrected = await computeSpecHash(compileSpec(input({ corrections: ['顔をもっと近く'] })))
    expect(corrected).not.toBe(plain)
  })

  it('差分の中身が違えば別のハッシュ', async () => {
    const a = await computeSpecHash(compileSpec(input({ corrections: ['顔をもっと近く'] })))
    const b = await computeSpecHash(compileSpec(input({ corrections: ['光を強く'] })))
    expect(a).not.toBe(b)
  })

  it('仕様のスキーマが差分を受け付ける', () => {
    const spec = compileSpec(input({ corrections: ['顔をもっと近く'] }))
    expect(ShotGenerationSpec.parse(spec).corrections).toEqual(['顔をもっと近く'])
    expect(ShotGenerationSpec.parse(compileSpec(input())).corrections).toBeUndefined()
  })
})

describe('Corrections（入力の検証）', () => {
  it('上限の件数まで受け付ける', () => {
    expect(Corrections.parse(Array.from({ length: MAX_CORRECTIONS }, (_, i) => `直し${i}`)))
      .toHaveLength(MAX_CORRECTIONS)
  })

  it('件数の上限を超えたら弾く', () => {
    const tooMany = Array.from({ length: MAX_CORRECTIONS + 1 }, (_, i) => `直し${i}`)
    expect(Corrections.safeParse(tooMany).success).toBe(false)
  })

  it('1 件あたりの長さの上限を超えたら弾く', () => {
    expect(Corrections.safeParse(['あ'.repeat(MAX_CORRECTION_LENGTH)]).success).toBe(true)
    expect(Corrections.safeParse(['あ'.repeat(MAX_CORRECTION_LENGTH + 1)]).success).toBe(false)
  })

  it('空白だけの要素を弾く（trim して空になるもの）', () => {
    expect(Corrections.safeParse(['   ']).success).toBe(false)
    expect(Corrections.safeParse(['']).success).toBe(false)
  })

  it('前後の空白を落として返す', () => {
    expect(Corrections.parse(['  顔をもっと近く  '])).toEqual(['顔をもっと近く'])
  })
})
