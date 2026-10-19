import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SfxAssetsProvider, useSfxAssets } from '@/components/workbench/sfx-assets'
import { renderInWorkbench } from './workbench-fixture'

/** 効果音の一覧の取り直し。効果音専用の合図（sfxEpoch）とサーバの読み直し（serverEpoch）で引き直す。 */
const Count = () => {
  const sfx = useSfxAssets()
  return <p>{sfx?.state === 'ready' ? `${String(sfx.value.length)} 件` : '…'}</p>
}

const renderProvider = () => {
  const api = {
    listClips: vi.fn().mockResolvedValue([]),
    listSfxJobs: vi.fn().mockResolvedValue([]),
    listUploadedSfx: vi.fn().mockResolvedValue([]),
  }
  const result = renderInWorkbench(
    <SfxAssetsProvider api={api}>
      <Count />
    </SfxAssetsProvider>,
  )
  return { api, ...result }
}

describe('SfxAssetsProvider', () => {
  it('効果音の合図（音を落とした・帯で直した・できた）で取り直す', async () => {
    const { api, rerenderWith } = renderProvider()
    await screen.findByText('0 件')
    expect(api.listClips).toHaveBeenCalledTimes(1)
    expect(api.listClips).toHaveBeenCalledWith(expect.any(String), 'SFX')

    rerenderWith({ sfxEpoch: 1 })
    await waitFor(() => {
      expect(api.listClips).toHaveBeenCalledTimes(2)
      expect(api.listSfxJobs).toHaveBeenCalledTimes(2)
      expect(api.listUploadedSfx).toHaveBeenCalledTimes(2)
    })
  })

  it('サーバの読み直しでも取り直す', async () => {
    const { api, rerenderWith } = renderProvider()
    await screen.findByText('0 件')
    rerenderWith({ serverEpoch: 1 })
    await waitFor(() => {
      expect(api.listClips).toHaveBeenCalledTimes(2)
    })
  })

  /** posterEpoch は Take や絵のたびに進む。見ると取り直しが多すぎる。 */
  it('絵の合図（posterEpoch）では取り直さない', async () => {
    const { api, rerenderWith } = renderProvider()
    await screen.findByText('0 件')
    rerenderWith({ posterEpoch: 1 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(api.listClips).toHaveBeenCalledTimes(1)
  })
})
