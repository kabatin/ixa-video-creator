import type { VoiceSpec } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { WireTake } from '@/lib/api-schemas'
import {
  REBUILT_TAKE_NOTE,
  UNRECORDED_IMAGE_NOTE,
  UNRECORDED_VOICE_NOTE,
  promptViewCopyText,
  promptViewFromImageJob,
  promptViewFromMusic,
  promptViewFromSfx,
  promptViewFromTake,
  promptViewFromVoice,
} from '@/lib/prompt-view'
import { validateCueRows } from '@/lib/sfx-cue-rows'
import { takeJson } from './fixtures'

/**
 * プロンプトビューアの中身（制作者 2026-10-25）。生成物ごとの記録を同じ形へ揃え、
 * 記録が無いときの扱い（組み立てた文で代わりにする・記録なしと出す・ボタンを出さない）を決める。
 */

const take = WireTake.parse(takeJson)
const AT = new Date('2026-10-25T03:00:00Z')

describe('promptViewFromTake', () => {
  it('送った文があればそれを出し、注記は付けない', () => {
    const view = promptViewFromTake({ ...take, sentPrompt: { prompt: 'integrated_multimodal_description: 走る', negativePrompt: 'blur' } }, 'CUT-03')

    expect(view?.title).toBe(`CUT-03 の Take #${String(take.index)}`)
    expect(view?.sections).toEqual([
      { label: 'プロンプト', text: 'integrated_multimodal_description: 走る', mono: true },
      { label: '除外する内容', text: 'blur', mono: true },
    ])
    expect(view?.note).toBeUndefined()
    expect(view?.tool).toBe(take.modelId)
    expect(view?.facts.map((fact) => fact.label)).toEqual(['長さ', 'シード'])
  })

  it('送った文が無い古い Take は、材料から組んだ文を出して「細部が違うことがある」と添える', () => {
    const view = promptViewFromTake({ ...take, sentPrompt: null }, null)

    expect(view?.title).toBe(`Take #${String(take.index)}`)
    expect(view?.sections[0]).toEqual({ label: 'プロンプト', text: take.spec.prompt, mono: true })
    expect(view?.note).toBe(REBUILT_TAKE_NOTE)
  })

  it('持ち込んだ動画はプロンプトで作っていないので出さない', () => {
    const imported = { ...take, providerParams: { kind: 'import' as const, sourceModel: null, fileName: null } }
    expect(promptViewFromTake(imported, 'CUT-03')).toBeNull()
  })
})

describe('promptViewFromImageJob', () => {
  it('送った指示の本文を出す', () => {
    const view = promptViewFromImageJob({ sentPrompt: '暗いガレージ', modelId: 'klein/flux-2-klein', queuedAt: AT }, 'CUT-03 の開始画像')
    expect(view.sections).toEqual([{ label: 'プロンプト', text: '暗いガレージ', mono: true }])
    expect(view.note).toBeUndefined()
    expect(view.tool).toBe('klein/flux-2-klein')
  })

  it('前置きを足して送る AI（Codex）の絵は、本文が足す前の文だと添える', () => {
    const view = promptViewFromImageJob({ sentPrompt: '暗いガレージ', sentWithPreamble: true, queuedAt: AT }, '開始画像')
    expect(view.note).toBe('この AI には決まった前置きを足して送っています')
  })

  it('記録する前に作った絵は、本文の代わりに「記録していません」と出す', () => {
    const view = promptViewFromImageJob({ sentPrompt: null, queuedAt: AT }, 'キーアート')
    expect(view.sections).toEqual([])
    expect(view.note).toBe(UNRECORDED_IMAGE_NOTE)
    expect(promptViewFromImageJob({ queuedAt: AT }, 'キーアート').note).toBe(UNRECORDED_IMAGE_NOTE)
  })
})

describe('promptViewFromMusic', () => {
  const source = {
    prompt: 'j-pop, upbeat',
    lyrics: '[chorus]\nいけ',
    instrumental: false,
    seed: 42,
    durationSec: 60,
    tool: 'ace_step',
    model: null,
    createdAt: AT,
  }

  it('曲調と歌詞を出し、同じ頼み方で作れる初期値を持つ（1 曲）', () => {
    const view = promptViewFromMusic('作った曲', source)
    expect(view?.sections).toEqual([
      { label: '曲調', text: 'j-pop, upbeat', mono: true },
      { label: '歌詞', text: '[chorus]\nいけ', mono: true },
    ])
    expect(view?.facts).toContainEqual({ label: 'シード', value: '42' })
    expect(view?.reuse).toEqual({
      kind: 'music',
      form: { prompt: 'j-pop, upbeat', lyrics: '[chorus]\nいけ', durationSec: '60', instrumental: false, count: '1' },
    })
  })

  it('歌なしの曲は歌詞を出さず、種を決めずに作った曲はそう言う', () => {
    const view = promptViewFromMusic('BGM', { ...source, instrumental: true, seed: null })
    expect(view?.sections.map((section) => section.label)).toEqual(['曲調'])
    expect(view?.facts).toContainEqual({ label: 'シード', value: '決めずに作った（毎回違う）' })
  })

  it('持ち込んだ曲（頼み方が無い）は出さない', () => {
    expect(promptViewFromMusic('持ち込み', null)).toBeNull()
  })
})

describe('promptViewFromSfx', () => {
  const source = {
    cue: { startSec: 24.72, durationSec: 1.5, prompt: 'metal clang', negativePrompt: 'music', volume: 0.8 },
    seed: 7,
    tool: 'stable_audio',
    createdAt: AT,
  }

  it('指示と除外する内容を出し、同じきっかけの 1 行を初期値に持つ（除外する内容も送る）', () => {
    const view = promptViewFromSfx('metal clang', source)
    expect(view?.sections.map((section) => section.label)).toEqual(['プロンプト', '除外する内容'])
    expect(view?.facts).toContainEqual({ label: 'シード', value: '7' })
    const rows = view?.reuse?.kind === 'sfx' ? view.reuse.rows : []
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ checked: true, start: '0:24.72', duration: '1.50', prompt: 'metal clang', volume: '0.8' })
    const sent = validateCueRows(rows)
    expect(sent.ok && sent.cues[0]).toMatchObject({ prompt: 'metal clang', negativePrompt: 'music', startSec: 24.72 })
  })

  it('取り込んだ音（頼み方が無い）は出さない', () => {
    expect(promptViewFromSfx('取り込んだ音', null)).toBeNull()
  })
})

describe('promptViewFromVoice', () => {
  const spec: VoiceSpec = {
    tool: 'gemini_api',
    model: null,
    voiceName: 'Kore',
    language: 'ja',
    styleNote: '落ち着いた声',
    direction: '囁くように',
    speed: 1,
    tuning: {},
    reading: 'すすめ',
  }

  it('送った読み方の指示があればそれを出す', () => {
    const view = promptViewFromVoice({ index: 2, voiceSpec: spec, sentStyle: '落ち着いた声。囁くように', createdAt: AT }, '1 行目')
    expect(view?.title).toBe('1 行目 の Take #2')
    expect(view?.sections).toEqual([
      { label: '読み', text: 'すすめ', mono: true },
      { label: '声の演技指示', text: '落ち着いた声。囁くように', mono: true },
    ])
    expect(view?.note).toBeUndefined()
  })

  it('送った指示の記録が無ければ声の設定から出し、そう添える', () => {
    const view = promptViewFromVoice({ index: 1, voiceSpec: spec, sentStyle: null, createdAt: AT }, '1 行目')
    expect(view?.sections.map((section) => section.label)).toEqual(['読み', '声のイメージ', '演出'])
    expect(view?.note).toBe(UNRECORDED_VOICE_NOTE)
  })

  it('読み方の指示を送らない AI では、読みだけを出す（演技指示を送ったように見せない・注記も付けない）', () => {
    const view = promptViewFromVoice({ index: 1, voiceSpec: { ...spec, tool: 'elevenlabs' }, sentStyle: null, createdAt: AT }, '1 行目')
    expect(view?.sections.map((section) => section.label)).toEqual(['読み'])
    expect(view?.note).toBeUndefined()
  })

  it('録音・複製の Take（指定が無い）は出さない', () => {
    expect(promptViewFromVoice({ index: 1, voiceSpec: null, createdAt: AT }, '1 行目')).toBeNull()
    expect(promptViewFromVoice({ index: 1, createdAt: AT }, '1 行目')).toBeNull()
  })
})

describe('promptViewCopyText', () => {
  it('欄ごとに見出しを付けて空行で区切り、補足を最後にまとめる', () => {
    const view = promptViewFromImageJob({ sentPrompt: '暗いガレージ', queuedAt: AT }, '開始画像')
    expect(promptViewCopyText({ ...view, facts: [{ label: '長さ', value: '3.00s' }] })).toBe('プロンプト\n暗いガレージ\n\n長さ: 3.00s')
  })
})
