import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AssetTree } from '@/components/workbench/asset-tree'
import { SfxAssetsProvider } from '@/components/workbench/sfx-assets'
import { WireSfxJob } from '@/lib/sfx-job-api'
import { WireTimelineClip } from '@/lib/timeline-api'
import { Location } from '@ixa/domain'
import { WireVoice } from '@/lib/narration-api'
import { locationJson } from './fixtures'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

const aLocation = Location.parse({ ...locationJson, createdAt: new Date(), updatedAt: new Date() })
const aVoice = WireVoice.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FD2',
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FD3',
  name: 'ナレーター',
  tool: 'macos_say',
  model: null,
  voiceName: 'Kyoko',
  styleNote: '',
  speed: 1,
  volume: 1,
  language: 'ja',
  tuning: {},
  textStyleId: null,
  characterId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})

/**
 * 素材ツリー（UI-WORKBENCH-2 §4.1）。実物が並び、＋ でその場に作れて、作った物を選ぶ。
 * 素材の共有状態はモックで差し替える（ツリーは `useAssets()` だけを見る）。
 */

const createLocation = vi.fn().mockResolvedValue({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD0', name: '体育館' })

const renderTree = (ui: ReactNode = <AssetTree />) =>
  renderInWorkbench(<>{ui}</>, {}, {
    brandAssets: { state: 'error', message: 'ブランド資産を読み込めませんでした: 500' },
    tracks: { state: 'loading' },
    actions: { ...assetStoreValue().actions, createLocation },
  })

describe('AssetTree', () => {
  /** 制作者 2026-10-19「戦子ちゃんにある声素材が欲しいと思ってしまった」。段ごとの取り込み口（ADR-0053）。 */
  it('声・楽曲の段の取り込み口は、その段の区分で取り込みの窓を開く', () => {
    const { value } = renderTree()
    fireEvent.click(screen.getByRole('button', { name: '声をほかのプロジェクトから取り込む' }))
    expect(value.openDialog).toHaveBeenLastCalledWith('library-import', { importSection: 'voices' })
    fireEvent.click(screen.getByRole('button', { name: '楽曲をほかのプロジェクトから取り込む' }))
    expect(value.openDialog).toHaveBeenLastCalledWith('library-import', { importSection: 'musicTracks' })
  })

  it('＋ で名前を入れて Enter すると作り、作った物を選ぶ', async () => {
    const { value } = renderTree()
    fireEvent.click(screen.getByRole('button', { name: 'ロケーションを追加' }))
    const input = screen.getByLabelText('ロケーションを追加（名前）')
    fireEvent.change(input, { target: { value: '体育館' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(createLocation).toHaveBeenCalledWith('体育館')
      expect(value.inspect).toHaveBeenCalledWith({ kind: 'location', id: '01ARZ3NDEKTSV4RRFFQ69G5FD0' })
    })
  })

  /** 2 回押さないと見えないのは分かりにくい（制作者 2026-10-17）。作品の方針はインスペクターで直す物なので別。 */
  it('素材は 1 回押しただけで素材ビューアに出す', () => {
    const { value } = renderInWorkbench(<AssetTree />, {}, { voices: { state: 'ready', value: [aVoice] } })

    fireEvent.click(screen.getByRole('button', { name: /ナレーター/ }))

    expect(value.inspect).toHaveBeenCalledWith({ kind: 'voice', id: aVoice.id })
    expect(value.openViewer).toHaveBeenCalled()
  })

  it('読めなかった一覧は「0 件」と言わず理由を出す（L-015）', () => {
    renderTree()
    expect(screen.getByRole('alert')).toHaveTextContent('ブランド資産を読み込めませんでした')
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('読み込み中の件数は … で、0 と言わない', () => {
    renderTree()
    const header = screen.getByRole('button', { name: '楽曲…' })
    expect(header).toHaveTextContent('…')
    expect(header).not.toHaveTextContent('(0)')
  })

  it('声（ADR-0038）が並び、使う AI を画面の言葉で添える。＋ で名前だけで作り、作った声を選ぶ', async () => {
    const createVoice = vi.fn().mockResolvedValue({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD1', name: '戦子の声' })
    const { value } = renderInWorkbench(<AssetTree />, {}, {
      voices: { state: 'ready', value: [aVoice] },
      actions: { ...assetStoreValue().actions, createVoice },
    })

    expect(screen.getByRole('button', { name: /ナレーター/ })).toHaveTextContent('Mac の声')
    expect(screen.queryByText('macos_say')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '声を追加' }))
    const input = screen.getByLabelText('声を追加（名前）')
    fireEvent.change(input, { target: { value: '戦子の声' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(createVoice).toHaveBeenCalledWith('戦子の声')
      expect(value.inspect).toHaveBeenCalledWith({ kind: 'voice', id: '01ARZ3NDEKTSV4RRFFQ69G5FD1' })
    })
  })

  /** 効果音は素材ツリーに無く、単品で聴くところが無かった（制作者 2026-10-19）。 */
  it('効果音（段に置いた音と作った候補）が並び、押すと素材ビューアで聴ける', async () => {
    const placed = '01ARZ3NDEKTSV4RRFFQ69G5FE1'
    const candidate = '01ARZ3NDEKTSV4RRFFQ69G5FE2'
    const api = {
      listClips: vi.fn().mockResolvedValue([
        WireTimelineClip.parse({
          id: '01ARZ3NDEKTSV4RRFFQ69G5FE3',
          projectId: '01ARZ3NDEKTSV4RRFFQ69G5FE4',
          track: 'SFX',
          startSec: 3.5,
          durationSec: 1.2,
          content: { type: 'media', mediaAssetId: placed, inSec: 0, outSec: 1.2, volume: 1 },
          createdAt: new Date().toISOString(),
        }),
      ]),
      listSfxJobs: vi.fn().mockResolvedValue([
        WireSfxJob.parse({
          id: '01ARZ3NDEKTSV4RRFFQ69G5FE5',
          status: 'succeeded',
          cue: { startSec: 3.5, durationSec: 1.2, prompt: 'whoosh', volume: 1 },
          mediaAssetIds: [placed, candidate],
          timelineClipId: '01ARZ3NDEKTSV4RRFFQ69G5FE3',
        }),
      ]),
    }
    const { value } = renderInWorkbench(
      <SfxAssetsProvider api={api}>
        <AssetTree />
      </SfxAssetsProvider>,
    )

    expect(await screen.findByRole('button', { name: '効果音(2)' })).toBeInTheDocument()
    // 足す口の無い段に ＋ は出さない（置くのはタイムラインへ落とすか AI に頼む）。
    expect(screen.queryByRole('button', { name: '効果音を追加' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /whoosh（候補 2）/ })).toHaveTextContent('置いていない')

    fireEvent.click(screen.getByRole('button', { name: /^whoosh$/ }))
    expect(value.inspect).toHaveBeenCalledWith({ kind: 'sfx', id: placed })
    expect(value.openViewer).toHaveBeenCalled()
  })

  /** 素材の上で右クリック（長押し）すると、その素材のメニュー（2026-09-30）。 */
  it('行を右クリックすると、その素材のメニューが開く', async () => {
    renderInWorkbench(<AssetTree />, {}, {
      locations: { state: 'ready', value: [{ ...aLocation, name: '体育館' }] },
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: /体育館/ }))

    expect(await screen.findByRole('menu', { name: '体育館 の操作' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'ロケーションを削除' })).toBeInTheDocument()
  })
})

