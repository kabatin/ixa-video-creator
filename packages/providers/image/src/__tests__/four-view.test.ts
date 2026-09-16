import { describe, expect, it } from 'vitest'
import {
  borderWidthFor,
  buildQuadrantTicks,
  FOUR_VIEW_LABELS,
  quadrantsFor,
} from '../stub/four-view.js'
import { isFourViewPrompt, placeholderModeFor } from '../stub/mode.js'
import {
  buildImageArgs,
  buildImageFilters,
  ImagePlaceholderInput,
  noiseFilterFor,
} from '../stub/render-image.js'

const baseInput = {
  outputPath: '/tmp/out.png',
  width: 1024,
  height: 1024,
  mode: 'four_view',
  backgroundColor: '#2E1A4D',
  quadrantColors: ['#2E1A4D', '#33205A', '#382766', '#3D2E72'],
  figureColor: '#C9B8E8',
  signature: '382fcbde',
  seed: null,
} as const

const countOf = (filters: string, needle: string): number => filters.split(needle).length - 1

describe('quadrantsFor', () => {
  it('正面 / 側面 / 背面 / 斜めの 4 象限を返す', () => {
    const quadrants = quadrantsFor(1024, 1024)
    expect(quadrants.map((q) => q.label)).toEqual([...FOUR_VIEW_LABELS])
    expect(quadrants.map((q) => [q.x, q.y])).toEqual([
      [0, 0],
      [512, 0],
      [0, 512],
      [512, 512],
    ])
  })

  it('隙間なくキャンバス全体を覆う', () => {
    const quadrants = quadrantsFor(1025, 721)
    const area = quadrants.reduce((sum, q) => sum + q.width * q.height, 0)
    expect(area).toBe(1025 * 721)
    // 端数は右下の象限に寄せる
    expect(quadrants[3]?.width).toBe(513)
    expect(quadrants[3]?.height).toBe(361)
  })
})

describe('borderWidthFor', () => {
  it('短辺に比例し、最低 2px を確保する', () => {
    expect(borderWidthFor(1024, 1024)).toBe(4)
    expect(borderWidthFor(64, 64)).toBe(2)
  })
})

describe('buildQuadrantTicks', () => {
  it('象限ごとに index + 1 本のバーを置き、何面目かを数えられるようにする', () => {
    const quadrants = quadrantsFor(1024, 1024)
    const counts = quadrants.map((q) => buildQuadrantTicks(q).length)
    expect(counts).toEqual([1, 2, 3, 4])
  })
})

describe('buildImageFilters（四面図 / drawtext あり）', () => {
  it('象限ごとに 塗り・頭・胴・枠線 を描き、ラベルを焼く', () => {
    const filters = buildImageFilters(baseInput, true)
    expect(countOf(filters, 'drawbox=')).toBe(16)
    expect(countOf(filters, 'drawtext=')).toBe(4)
    for (const label of FOUR_VIEW_LABELS) expect(filters).toContain(`text=${label}:`)
  })

  it('象限ごとに違う色調を使う', () => {
    const filters = buildImageFilters(baseInput, true)
    for (const color of baseInput.quadrantColors) {
      expect(filters).toContain(`color=0x${color.slice(1)}:t=fill`)
    }
  })
})

describe('buildImageFilters（四面図 / drawtext なしへ縮退）', () => {
  it('drawtext を一切使わず、ティックマークで面を示す', () => {
    const filters = buildImageFilters(baseInput, false)
    expect(filters).not.toContain('drawtext')
    // 象限 16 個 + ティック 1+2+3+4
    expect(countOf(filters, 'drawbox=')).toBe(26)
  })

  it('象限の枠線は縮退しても残る（四面図であることが分かる）', () => {
    const filters = buildImageFilters(baseInput, false)
    expect(countOf(filters, 'color=0xFFFFFF:t=4')).toBe(4)
  })
})

describe('buildImageFilters（通常モード）', () => {
  const plain = { ...baseInput, mode: 'plain' } as const

  it('単色背景に署名バーを置く', () => {
    const filters = buildImageFilters(plain, true)
    expect(countOf(filters, 'drawbox=')).toBe(4)
    expect(filters).toContain('text=382fcbde:')
  })

  it('drawtext が無ければバーだけになる', () => {
    const filters = buildImageFilters(plain, false)
    expect(countOf(filters, 'drawbox=')).toBe(4)
    expect(filters).not.toContain('drawtext')
  })
})

describe('seed', () => {
  it('seed が null ならノイズを乗せない', () => {
    expect(buildImageFilters(baseInput, true)).not.toContain('noise=')
  })

  it('seed があればノイズを乗せる', () => {
    expect(buildImageFilters({ ...baseInput, seed: 42 }, true)).toContain('noise=all_seed=42')
  })

  it('同じ seed なら同じフィルタ、違う seed なら違うフィルタ', () => {
    expect(noiseFilterFor(1234)).toBe(noiseFilterFor(1234))
    expect(noiseFilterFor(1234)).not.toBe(noiseFilterFor(1235))
    expect(noiseFilterFor(-7)).toMatch(/^noise=all_seed=7:all_strength=\d+:all_flags=t\+u$/)
  })
})

describe('buildImageArgs', () => {
  it('解像度を lavfi の color 源に渡し、1 枚だけ書き出す', () => {
    const args = buildImageArgs(baseInput, true)
    expect(args).toContain('color=c=#2E1A4D:s=1024x1024')
    expect(args).toContain('-frames:v')
    expect(args).toContain('-update')
    expect(args[args.length - 1]).toBe('/tmp/out.png')
  })
})

describe('ImagePlaceholderInput', () => {
  it('#RRGGBB 以外の色を受け付けない', () => {
    expect(() => ImagePlaceholderInput.parse({ ...baseInput, backgroundColor: 'red' })).toThrow()
  })

  it('象限の色は 4 つ必要', () => {
    expect(() =>
      ImagePlaceholderInput.parse({ ...baseInput, quadrantColors: ['#111111', '#222222'] }),
    ).toThrow()
  })

  it('未知のモードを受け付けない', () => {
    expect(() => ImagePlaceholderInput.parse({ ...baseInput, mode: 'collage' })).toThrow()
  })
})

describe('placeholderModeFor', () => {
  it('四面図を要求するプロンプトを四面図モードにする', () => {
    expect(placeholderModeFor('takepi turnaround sheet')).toBe('four_view')
    expect(placeholderModeFor('takepi の四面図')).toBe('four_view')
    expect(placeholderModeFor('FOUR VIEW of takepi')).toBe('four_view')
    expect(isFourViewPrompt('four_view')).toBe(true)
  })

  it('それ以外は通常モードにする', () => {
    expect(placeholderModeFor('takepi の SFL ジャージ姿')).toBe('plain')
    expect(isFourViewPrompt('wardrobe close up')).toBe(false)
  })
})
