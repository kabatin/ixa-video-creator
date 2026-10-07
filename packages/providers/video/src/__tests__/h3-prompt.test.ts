import type { ShotCamera, ShotGenerationSpec } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { buildH3Prompt, cameraMovementSentence, H3_PROMPT_FORMAT } from '../vpipe/h3-prompt.js'
import { makeSpec } from './fixtures.js'

/**
 * MiniMax H3 の公式の書き方への組み直し（ADR-0042）。
 *
 * **送った文面は Take に保存していない。** 版（`H3_PROMPT_FORMAT`）だけを記録し、
 * 仕様と版から組み直せることを前提にしている。だから**版ごと文面を凍結する**。
 * 下のゴールデンが落ちたら、直すのではなく新しい版（`h3-official-v2`）を足すこと。
 */

const aCamera = (overrides: Partial<ShotCamera> = {}): ShotCamera => ({
  size: 'medium',
  angleH: null,
  angle: null,
  lensMm: null,
  movement: null,
  movementIntensity: null,
  ...overrides,
})

const aSpec = (overrides: Partial<ShotGenerationSpec> = {}): ShotGenerationSpec =>
  makeSpec({ camera: aCamera(), ...overrides })

const build = (spec: ShotGenerationSpec, hasStartImage = true, hasEndImage = false): string =>
  buildH3Prompt({ spec, hasStartImage, hasEndImage })

describe('H3_PROMPT_FORMAT', () => {
  it('版を名乗る（Take にはこれだけ残る）', () => {
    expect(H3_PROMPT_FORMAT).toBe('h3-official-v1')
  })
})

describe('buildH3Prompt のゴールデン（h3-official-v1 を凍結する）', () => {
  /** 画風・景別・1 コマ目・動作・直し・カメラが全部ある仕様。 */
  const rich = aSpec({
    durationSec: 5.167,
    promptParts: {
      styleGuide: 'iXA の和モダン、彩度高めのセル画',
      shotDescription: '椅子から勢いよく立ち上がる戦子を、全身が入る引きで',
      identityAnchors: ['long navy hair with yellow streaks'],
      styleTokens: ['cel shading', 'bold outlines'],
      colorPalette: ['vermilion', 'indigo'],
      wardrobeTokens: ['yellow happi coat'],
      cameraFragment: 'medium',
      moodFragment: '再起',
    },
    camera: aCamera({ size: 'wide', angleH: 'front', angle: 'low', lensMm: 50, movement: 'tilt', movementIntensity: 'subtle' }),
    corrections: ['顔が切れないようにする'],
  })

  it('一字一句この通りに組む', () => {
    expect(build(rich)).toBe(
      [
        'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
        '',
        'integrated_multimodal_description: [Shot 1] iXA の和モダン、彩度高めのセル画. ' +
          'cel shading, bold outlines. Color palette: vermilion, indigo. ' +
          'Framed as a wide shot, from the front, from a low angle, on a 50mm lens. ' +
          'At the first frame: long navy hair with yellow streaks, yellow happi coat. ' +
          '椅子から勢いよく立ち上がる戦子を、全身が入る引きで. Mood: 再起. 顔が切れないようにする. ' +
          'The camera tilts with small amplitude at slow speed.',
        '',
        'overall_soundscape: Natural ambience that matches the scene.',
        '',
        'non_diegetic_music: None.',
      ].join('\n'),
    )
  })
})

describe('参照画像の 1 行目', () => {
  it('開始画像だけなら I2VA の 1 行（一字一句この通り）', () => {
    expect(build(aSpec()).split('\n')[0]).toBe(
      'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    )
  })

  it('画像が無ければ 1 行目を書かない', () => {
    expect(build(aSpec(), false).startsWith('integrated_multimodal_description:')).toBe(true)
  })

  /** 最後の画像を付ける画面はまだ無いが、書式は先に決めておく（`S.SS` は小数 2 桁）。 */
  it('開始と最後の画像なら FL2VA の 1 行で、尺を小数 2 桁で書く', () => {
    const line = build(aSpec({ durationSec: 5.167 }), true, true).split('\n')[0] ?? ''

    expect(line.startsWith('How the reference pictures align with the target video')).toBe(true)
    expect(line).toContain('aligns with the 0.00-second mark')
    expect(line).toContain('aligns with the 5.17-second mark')
  })
})

describe('欄の順序', () => {
  it('説明 → 環境音 → 背景音楽の順に並ぶ', () => {
    const text = build(aSpec())
    const order = ['integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:'].map(
      (label) => text.indexOf(label),
    )

    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  /** 音は vpipe-api が捨てるが、**書式としては必須**なので空にしない。 */
  it('音の 2 欄は必ず入る', () => {
    expect(build(aSpec())).toContain('overall_soundscape: Natural ambience that matches the scene.')
    expect(build(aSpec())).toContain('non_diegetic_music: None.')
  })
})

describe('カメラの動き（資料 3.3 の表）', () => {
  it('指定が無ければ 1 文も書かない（勝手に static にしない）', () => {
    expect(cameraMovementSentence(aCamera())).toBeNull()
    expect(build(aSpec())).not.toContain('The camera')
  })

  it('static に振れ幅と速さを書かない', () => {
    expect(cameraMovementSentence(aCamera({ movement: 'static', movementIntensity: 'strong' }))).toBe(
      'The camera holds a static shot.',
    )
  })

  it('強さが無ければ動きだけを書く', () => {
    expect(cameraMovementSentence(aCamera({ movement: 'pan' }))).toBe('The camera pans.')
  })

  it.each([
    { movement: 'pan' as const, expected: 'The camera pans with medium amplitude at moderate speed.' },
    { movement: 'tilt' as const, expected: 'The camera tilts with medium amplitude at moderate speed.' },
    { movement: 'push_in' as const, expected: 'The camera pushes in with medium amplitude at moderate speed.' },
    { movement: 'pull_out' as const, expected: 'The camera pulls out with medium amplitude at moderate speed.' },
    {
      movement: 'tracking' as const,
      expected: 'The camera follows the subject in a tracking shot with medium amplitude at moderate speed.',
    },
    { movement: 'handheld' as const, expected: 'The camera shakes, handheld with medium amplitude at moderate speed.' },
    { movement: 'crane' as const, expected: 'The camera cranes with medium amplitude at moderate speed.' },
    {
      movement: 'orbit' as const,
      expected: 'The camera arcs around the subject with medium amplitude at moderate speed.',
    },
  ])('$movement は 1 文の英語になる', ({ movement, expected }) => {
    expect(cameraMovementSentence(aCamera({ movement, movementIntensity: 'moderate' }))).toBe(expected)
  })

  it.each([
    { intensity: 'subtle' as const, expected: 'with small amplitude at slow speed' },
    { intensity: 'moderate' as const, expected: 'with medium amplitude at moderate speed' },
    { intensity: 'strong' as const, expected: 'with large amplitude at fast speed' },
  ])('強さ $intensity は振れ幅と速さになる', ({ intensity, expected }) => {
    expect(cameraMovementSentence(aCamera({ movement: 'pan', movementIntensity: intensity }))).toBe(
      `The camera pans ${expected}.`,
    )
  })

  it('カメラの文は説明の最後に来る（公式の推奨順）', () => {
    const text = build(aSpec({ camera: aCamera({ movement: 'tilt' }) }))
    const line = text.split('\n').find((row) => row.startsWith('integrated_multimodal_description:')) ?? ''

    expect(line.endsWith('The camera tilts.')).toBe(true)
  })
})

describe('中身の運び方', () => {
  it('カット説明は日本語のまま入れる（英訳しない）', () => {
    const text = build(aSpec({ promptParts: { ...aSpec().promptParts, shotDescription: '机を押して立つ' } }))

    expect(text).toContain('机を押して立つ.')
  })

  /** 落とすと、レビューの指摘から人が選んだ直しが Provider に届かない。 */
  it('直しを落とさない', () => {
    const text = build(aSpec({ corrections: ['顔を切らない', '手を 5 本にしない'] }))

    expect(text).toContain('顔を切らない. 手を 5 本にしない.')
  })

  it('空の項目では余計な区切りを作らない', () => {
    const line = build(aSpec()).split('\n')[2] ?? ''

    expect(line).toBe('integrated_multimodal_description: [Shot 1] Framed as a medium shot. takepi が勝利する.')
    expect(line).not.toContain('..')
    expect(line).not.toContain('. .')
  })

  it('日本語の句点で終わる文に `.` を足さない', () => {
    const text = build(aSpec({ promptParts: { ...aSpec().promptParts, shotDescription: '机を押して立つ。' } }))

    expect(text).toContain('机を押して立つ。')
    expect(text).not.toContain('机を押して立つ。.')
  })
})
