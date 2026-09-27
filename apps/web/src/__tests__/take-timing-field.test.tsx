import type { MediaAssetId } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TakeTimingField } from '@/components/workbench/inspector/take-timing-field'

/** 「Take を尺に合わせる」（ADR-0026）。採用 Take の長さから倍率を出し、切り替えを保存する。 */

const adopted = { mediaAssetId: 'asset-1' as MediaAssetId }
const shot = { timing: 'trim' as const, durationSec: 5, sourceInSec: 0 }

describe('TakeTimingField', () => {
  it('採用 Take が短ければ、止まることと合わせたときの倍率を出す', async () => {
    const api = { mediaDurationSec: vi.fn(() => Promise.resolve(4)) }
    render(<TakeTimingField shot={shot} adopted={adopted} api={api} onSave={() => Promise.resolve()} />)

    expect(await screen.findByText('Take が 1.00s 足りず、最後のコマで止まります。合わせると 0.80 倍になります。')).toBeTruthy()
    expect(api.mediaDurationSec).toHaveBeenCalledWith('asset-1')
  })

  it('チェックすると fit、外すと trim で保存する', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const api = { mediaDurationSec: vi.fn(() => Promise.resolve(null)) }
    const { rerender } = render(<TakeTimingField shot={shot} adopted={adopted} api={api} onSave={onSave} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Take を尺に合わせる（速度を変える）' }))
    expect(onSave).toHaveBeenLastCalledWith('fit')

    rerender(<TakeTimingField shot={{ ...shot, timing: 'fit' }} adopted={adopted} api={api} onSave={onSave} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Take を尺に合わせる（速度を変える）' }))
    expect(onSave).toHaveBeenLastCalledWith('trim')
  })

  it('採用が無ければ長さを読まない', () => {
    const api = { mediaDurationSec: vi.fn(() => Promise.resolve(4)) }
    render(<TakeTimingField shot={shot} adopted={null} api={api} onSave={() => Promise.resolve()} />)

    expect(api.mediaDurationSec).not.toHaveBeenCalled()
  })

  it('長さを読めなければそう言う（黙って倍率を消さない）', async () => {
    const api = { mediaDurationSec: vi.fn(() => Promise.reject(new Error('boom'))) }
    render(<TakeTimingField shot={shot} adopted={adopted} api={api} onSave={() => Promise.resolve()} />)

    expect(await screen.findByText(/Take の長さを読めませんでした/)).toBeTruthy()
  })
})
