import { describe, expect, it } from 'vitest'
import { barCountFor, buildProgressSegments } from '../stub/signature-bars.js'

const PROGRESS_SEGMENTS = 24
import {
  buildPlaceholderArgs,
  buildPlaceholderFilters,
  frameCountFor,
  noiseFilterFor,
  PlaceholderInput,
  textStyleFor,
} from '../stub/render-placeholder.js'

const baseInput = {
  outputPath: '/tmp/out.mp4',
  durationSec: 4,
  width: 1280,
  height: 720,
  fps: 24,
  backgroundColor: '#2E1A4D',
  lines: ['shot 01ARZ3ND', 'medium_closeup'],
  signature: '382fcbde9a0011ff',
  seed: null,
} as const

describe('textStyleFor', () => {
  it('フォントサイズは高さの 4%', () => {
    expect(textStyleFor(720).fontSize).toBe(29)
    expect(textStyleFor(1080).fontSize).toBe(43)
  })

  it('極端に小さい解像度でも読める下限を持つ', () => {
    expect(textStyleFor(100).fontSize).toBe(10)
  })
})

describe('frameCountFor', () => {
  it('尺 × fps をフレーム数にする', () => {
    expect(frameCountFor(3.75, 24)).toBe(90)
    expect(frameCountFor(4, 30)).toBe(120)
  })

  it('端数は最も近いフレームに丸める', () => {
    expect(frameCountFor(3.75, 30)).toBe(113)
  })
})

describe('noiseFilterFor', () => {
  it('同じ seed なら同じフィルタ文字列になる', () => {
    expect(noiseFilterFor(1234)).toBe(noiseFilterFor(1234))
  })

  it('seed が違えば強度かシードが変わる', () => {
    expect(noiseFilterFor(1234)).not.toBe(noiseFilterFor(1235))
  })

  it('負の seed も扱える', () => {
    expect(noiseFilterFor(-7)).toMatch(/^noise=all_seed=7:all_strength=\d+:all_flags=t\+u$/)
  })
})

describe('buildPlaceholderFilters', () => {
  it('行ごとに drawtext を積み、タイムコードを最後に置く', () => {
    const filters = buildPlaceholderFilters(baseInput, true)
    expect(filters.split('drawtext=').length - 1).toBe(3)
    expect(filters).toContain(String.raw`%{pts\\:hms} | frame %{n}`)
  })

  it('seed が null ならノイズを乗せない', () => {
    expect(buildPlaceholderFilters(baseInput, true)).not.toContain('noise=')
  })

  it('seed があればノイズを乗せる', () => {
    expect(buildPlaceholderFilters({ ...baseInput, seed: 42 }, true)).toContain('noise=all_seed=42')
  })

  it('空行は描画しない', () => {
    const filters = buildPlaceholderFilters({ ...baseInput, lines: ['a', '', 'b'] }, true)
    expect(filters.split('drawtext=').length - 1).toBe(3)
  })
})

describe('buildPlaceholderArgs', () => {
  it('尺・解像度・fps を lavfi の color 源に渡す', () => {
    const args = buildPlaceholderArgs(baseInput, true)
    expect(args).toContain('color=c=#2E1A4D:s=1280x720:r=24:d=4')
    expect(args).toContain('+faststart')
    expect(args[args.length - 1]).toBe('/tmp/out.mp4')
  })
})

describe('PlaceholderInput', () => {
  it('7 行以上は受け付けない', () => {
    expect(() =>
      PlaceholderInput.parse({ ...baseInput, lines: ['1', '2', '3', '4', '5', '6', '7'] }),
    ).toThrow()
  })

  it('#RRGGBB 以外の色を受け付けない', () => {
    expect(() => PlaceholderInput.parse({ ...baseInput, backgroundColor: 'red' })).toThrow()
  })
})

describe('buildPlaceholderFilters（drawtext が無い環境）', () => {
  it('drawtext を一切使わない', () => {
    const filters = buildPlaceholderFilters(baseInput, false)
    expect(filters).not.toContain('drawtext')
  })

  it('署名から決まるカラーバー・進行セグメント・フレームティッカーを描く', () => {
    const filters = buildPlaceholderFilters(baseInput, false)
    const boxes = filters.split('drawbox=').length - 1
    expect(boxes).toBe(barCountFor(baseInput.signature) + PROGRESS_SEGMENTS + 1)
  })

  it('進行表示はフレームごとに評価される enable で点灯させる', () => {
    // drawbox の x/y/w/h 式は毎フレーム再評価されないため、伸びるバーは作れない。
    const filters = buildPlaceholderFilters(baseInput, false)
    expect(filters).toContain(String.raw`enable=gte(t\,0.000)`)
    expect(filters).toContain(String.raw`enable=gte(t\,3.833)`)
    expect(filters).toContain(String.raw`enable=eq(mod(floor(t*24+0.5)\,2)\,0)`)
  })

  it('同じ署名なら同じ絵、違う署名なら違う絵になる', () => {
    const a = buildPlaceholderFilters(baseInput, false)
    const b = buildPlaceholderFilters({ ...baseInput, signature: '382fcbde9a0011ff' }, false)
    const c = buildPlaceholderFilters({ ...baseInput, signature: 'ff11009aedbcf283' }, false)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('縮退時も seed のノイズは乗る', () => {
    expect(buildPlaceholderFilters({ ...baseInput, seed: 7 }, false)).toContain('noise=all_seed=7')
  })
})

describe('buildProgressSegments', () => {
  it('セグメント数を変えられる', () => {
    const filters = buildProgressSegments(4, 1280, 720, 4)
    expect(filters.split('drawbox=').length - 1).toBe(4)
    expect(filters).toContain(String.raw`enable=gte(t\,3.000)`)
  })
})
