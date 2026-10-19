import { aceStepMusicModel, stableAudioMusicModel } from '@ixa/provider-music'
import { describe, expect, it } from 'vitest'
import { musicAdapters } from '../../music-wiring.js'

/**
 * 曲の口の並び（ADR-0048 追記）。worker はジョブに記されたモデルで口を引くので、
 * API が「使える」と言うモデルには必ず口がある（無いと「この環境では作れません」で落ちる）。
 */
const off = { enabled: false, baseUrl: 'http://127.0.0.1:1', token: null }
const on = { enabled: true, baseUrl: 'http://127.0.0.1:1', token: null }

const modelIds = (aceStep: typeof off, sfxApi: typeof off): readonly string[] =>
  musicAdapters('/tmp/ixa-music-wiring', aceStep, sfxApi).map((adapter) => adapter.model.id)

describe('musicAdapters', () => {
  it('ACE-Step は ace-step-api を、Stable Audio の歌なし BGM は sfx-api を有効にしたときだけ並ぶ', () => {
    expect(modelIds(off, off)).toEqual([])
    expect(modelIds(on, off)).toEqual([aceStepMusicModel.id])
    expect(modelIds(off, on)).toEqual([stableAudioMusicModel.id])
    expect(modelIds(on, on)).toEqual([aceStepMusicModel.id, stableAudioMusicModel.id])
  })

  it('Stable Audio の口は sfx-api の曲の口で、モデルを持っている', () => {
    const [adapter] = musicAdapters('/tmp/ixa-music-wiring', off, on)
    expect(adapter?.provider.models).toEqual([stableAudioMusicModel])
    expect(adapter?.provider.exclusiveResource).toBe('local-gpu')
  })
})
