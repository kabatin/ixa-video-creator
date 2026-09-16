import { describe, expect, it } from 'vitest'
import { ProjectId, ShotId } from '../common/ids.js'
import type { Shot } from '../shot/shot.js'
import { assemblePrompt, compileSpec, computeSpecHash } from '../generation/spec-compiler.js'
import type { CompileInput } from '../generation/spec-compiler.js'

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
  description: 'iXA CUP 決勝で takepi が勝利する',
  dialogue: null,
  camera: {
    size: 'medium_closeup', angleH: 'front_left', angle: 'low',
    lensMm: 50, movement: 'push_in', movementIntensity: 'subtle',
  },
  mood: '緊迫',
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
