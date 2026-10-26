import { describe, expect, it } from 'vitest'
import { UpdateShotBody } from '@/lib/api-schemas'
import {
  MASTERING_OPTIONS,
  formatTakeAudioVolume,
  masteringHint,
  masteringValue,
  parseTakeAudioVolume,
  takeAudioVolumeProblem,
} from '@/lib/take-audio'

/** ADR-0060: Take の音の大きさと消音、仕上げの音量の言葉。決め方は domain、ここは言葉にするだけ。 */

describe('Take の音の大きさ', () => {
  it('割合で見せ、割合で読む（% は省いてよい）', () => {
    expect(formatTakeAudioVolume(1)).toBe('100%')
    expect(formatTakeAudioVolume(1.25)).toBe('125%')
    expect(parseTakeAudioVolume('80%')).toBe(0.8)
    expect(parseTakeAudioVolume(' 150 ')).toBe(1.5)
  })

  it('0〜200% の外や数でないものは読まず、直し方を言う', () => {
    expect(parseTakeAudioVolume('201')).toBeNull()
    expect(parseTakeAudioVolume('-1')).toBeNull()
    expect(parseTakeAudioVolume('大きく')).toBeNull()
    expect(takeAudioVolumeProblem('201')).toBe('0〜200% で入れてください')
    expect(takeAudioVolumeProblem('120%')).toBeNull()
  })

  it('PATCH の本文に載る', () => {
    expect(UpdateShotBody.parse({ takeAudioVolume: 1.2, takeAudioMuted: true })).toEqual({ takeAudioVolume: 1.2, takeAudioMuted: true })
  })
})

describe('仕上げの音量', () => {
  it('選択肢は 2 つ（画面の言葉）', () => {
    expect(MASTERING_OPTIONS).toEqual([
      { value: 'loudnorm', label: '全体をそろえる（今まで通り）' },
      { value: 'peak', label: '山だけ抑える' },
    ])
  })

  it('選んでいなければ、セリフの有無で決まった方を選んでいる形に見せ、理由を添える', () => {
    expect(masteringValue(null, true)).toBe('peak')
    expect(masteringValue(null, false)).toBe('loudnorm')
    expect(masteringHint(null, true)).toBe('セリフのある Shot があるので「山だけ抑える」にしています。選ぶと、その後はセリフの有無で変えません。')
    expect(masteringHint(null, false)).toBe('セリフのある Shot が無いので「全体をそろえる」にしています。選ぶと、その後はセリフの有無で変えません。')
  })

  it('選んだら、選んだ方の説明だけ', () => {
    expect(masteringValue('loudnorm', true)).toBe('loudnorm')
    expect(masteringHint('peak', false)).toBe('音の山だけを抑えます。Take の声と曲の釣り合いはそのまま残ります。')
    expect(masteringHint('loudnorm', true)).toBe('書き出し全体の大きさを YouTube・SNS の基準にそろえます。')
  })
})
