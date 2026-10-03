import { describe, expect, it } from 'vitest'
import { ASPECT_CHOICES, FPS_CHOICES, resolutionChoicesFor, videoFpsFor } from '@/lib/project-spec-choices'

/**
 * 新規作成・設定で選ぶ「形・大きさ・fps」（制作者 2026-10-03「アスペクト比は数字「16:9」を見ても、これって縦だっけ？
 * 横だっけ？みたいになるし形も分かりづらいので実際のサイズ図を選ぶ形がよさそう」「解像度もサイズ図的なものを選ぶ形式」
 * 「使う生成 AI 欄や FPS 欄もよしなに合わせて」）。
 */
describe('ASPECT_CHOICES', () => {
  it('形の名前と使いどころを言い、図を描くための縦横を持つ', () => {
    expect(ASPECT_CHOICES.map((choice) => [choice.value, choice.name])).toEqual([
      ['16:9', '横長'],
      ['9:16', '縦長'],
      ['1:1', '正方形'],
      ['4:5', 'やや縦長'],
      ['21:9', 'シネスコ'],
    ])
    expect(ASPECT_CHOICES.every((choice) => choice.hint.length > 0)).toBe(true)
    expect(ASPECT_CHOICES.find((choice) => choice.value === '9:16')).toMatchObject({ width: 9, height: 16 })
  })
})

describe('resolutionChoicesFor', () => {
  it('名前・大きさ・使いどころを言う。既定（先頭）は「標準」、大きいのは時間がかかる、小さいのは軽い', () => {
    const choices = resolutionChoicesFor('16:9')
    expect(choices.map((choice) => [choice.name, choice.size, choice.hint])).toEqual([
      ['FHD', '1920×1080', '標準（迷ったらこれ）'],
      ['HD', '1280×720', '軽い（確認や試作に）'],
      ['4K', '3840×2160', '細かい（書き出しに時間がかかる）'],
    ])
  })

  it('図の大きさは、その形でいちばん大きいものに対する割合', () => {
    const choices = resolutionChoicesFor('16:9')
    expect(choices.find((choice) => choice.name === '4K')?.scale).toBe(1)
    expect(choices.find((choice) => choice.name === 'FHD')?.scale).toBeCloseTo(0.5)
  })
})

describe('FPS_CHOICES', () => {
  it('4 つを使いどころつきで並べ、30 を迷ったらこれと言う', () => {
    expect(FPS_CHOICES.map((choice) => choice.value)).toEqual([24, 25, 30, 60])
    expect(FPS_CHOICES.find((choice) => choice.value === 30)?.hint).toContain('迷ったらこれ')
  })
})

describe('videoFpsFor', () => {
  const model = (providerId: string, fps: readonly number[]) => ({ providerId, fps })

  it('選んでいる動画の AI のモデルが作れる fps を、重ねずに小さい順で返す', () => {
    expect(videoFpsFor([model('vpipe', [30, 24]), model('vpipe', [24]), model('fal', [60])], 'vpipe')).toEqual([24, 30])
  })

  it('その AI のモデルが無ければ null（分からない。合わせる案内を出さない）', () => {
    expect(videoFpsFor([model('fal', [24])], 'vpipe')).toBeNull()
  })
})
