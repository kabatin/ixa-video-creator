/**
 * @vitest-environment jsdom
 */
import { ProjectId, TimelineClipId } from '@ixa/domain'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssetStoreContext } from '@/components/workbench/asset-store'
import { TextStylePresets } from '@/components/workbench/inspector/text-style-presets'
import type { TextStyleApi } from '@/lib/text-style-api'
import { PROJECT_ID } from './fixtures'
import { assetStoreValue } from './workbench-fixture'

/**
 * テロップのスタイルの作る・直す・消すを ⌘Z で戻したら、スタイルの一覧を読み直す（2026-10-19）。
 * 一覧はこの部品が自分で読むので、素材の読み直し（`reloadAll`）が進める合図で読み直す。
 */
describe('TextStylePresets の読み直し', () => {
  it('素材の読み直しの合図が進むと、スタイルの一覧を読み直す', async () => {
    const listTextStyles = vi.fn().mockResolvedValue([])
    const api = { listTextStyles } as unknown as TextStyleApi
    const presets = (epoch: number) => (
      <AssetStoreContext.Provider value={assetStoreValue({ textStylesEpoch: epoch })}>
        <TextStylePresets
          projectId={ProjectId.parse(PROJECT_ID)}
          clipId={TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1')}
          style={{}}
          styleId={null}
          textClips={[]}
          onApplied={vi.fn()}
          api={api}
        />
      </AssetStoreContext.Provider>
    )
    const view = render(presets(0))
    await waitFor(() => {
      expect(listTextStyles).toHaveBeenCalledTimes(1)
    })

    view.rerender(presets(1))
    await waitFor(() => {
      expect(listTextStyles).toHaveBeenCalledTimes(2)
    })
  })
})
