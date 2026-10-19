import { describe, expect, it } from 'vitest'
import { SFX_DEFAULT_MAX_SEC, defaultAudioRole } from '@/lib/audio-intake-role'

/**
 * 音のファイルを取り込むとき、楽曲か効果音かの初めの選び（制作者 2026-10-19「ドラッグしたとき、楽曲か効果音かを
 * 選べるようにしましょう」）。短い音は効果音、長い音は楽曲。何本かまとめて落としたら 1 回で選ぶ。
 */
describe('defaultAudioRole', () => {
  it('短い音だけなら効果音', () => {
    expect(defaultAudioRole([1.2, SFX_DEFAULT_MAX_SEC])).toBe('sfx')
  })

  it('長い音が 1 本でもあれば楽曲', () => {
    expect(defaultAudioRole([1.2, SFX_DEFAULT_MAX_SEC + 0.01])).toBe('music')
  })

  it('長さを読めなかった音があれば楽曲（いままでの扱い）', () => {
    expect(defaultAudioRole([1.2, null])).toBe('music')
  })

  it('1 本も無ければ楽曲', () => {
    expect(defaultAudioRole([])).toBe('music')
  })
})
