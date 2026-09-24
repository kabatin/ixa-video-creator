import type { MusicTrack } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalysisStarter } from '@/components/analysis-starter'

/**
 * 曲を入れたら**解析まで自分で進む**（§7.4）。
 *
 * 以前は曲を入れた直後に解析が走っているのに、画面は
 * 「この楽曲はまだ解析されていません・解析を実行」のままだった。
 * すでに動いているものを、もう一度押させる形になっていた（実測）。
 * 解析されていない曲では何もできないので、押させる意味が無い。
 *
 * 終わるまでは進捗ダイアログで手を止める。**押したのに何も起きないように見える**のを無くす。
 */

const requestAnalysis = vi.fn()
const getAnalysis = vi.fn()

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({
    requestAnalysis: (id: string): Promise<unknown> => requestAnalysis(id) as Promise<unknown>,
    getAnalysis: (id: string): Promise<unknown> => getAnalysis(id) as Promise<unknown>,
  }),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const aTrack = (): MusicTrack =>
  ({
    id: 'track-1',
    title: 'test',
  }) as unknown as MusicTrack

beforeEach(() => {
  requestAnalysis.mockReset()
  getAnalysis.mockReset()
  requestAnalysis.mockResolvedValue({ accepted: true })
  // ずっと走っている状態にして、待っている間の見た目を確かめる。
  getAnalysis.mockResolvedValue(null)
})

describe('解析は自分から始まる', () => {
  it('置かれた時点で解析を頼む（人が押さない）', async () => {
    render(<AnalysisStarter track={aTrack()} />)
    await waitFor(() => {
      expect(requestAnalysis).toHaveBeenCalledTimes(1)
    })
  })

  it('待っている間は進捗ダイアログで手を止める', async () => {
    render(<AnalysisStarter track={aTrack()} />)
    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeTruthy()
    })
    expect(screen.getByText(/拍と小節頭を数えています/)).toBeTruthy()
  })

  /**
   * **勝手に繰り返さない。** 失敗したあとも自動で頼み続けると、同じ失敗を積み上げる。
   * 描き直しは何度でも起きるので、頼むのは 1 曲につき 1 回。
   */
  it('描き直しても頼み直さない', async () => {
    const view = render(<AnalysisStarter track={aTrack()} />)
    await waitFor(() => {
      expect(requestAnalysis).toHaveBeenCalledTimes(1)
    })
    view.rerender(<AnalysisStarter track={aTrack()} />)
    expect(requestAnalysis).toHaveBeenCalledTimes(1)
  })
})
