import { MusicTrack, MusicTrackId } from '@ixa/domain'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PromptViewerProvider } from '@/components/prompt/prompt-viewer-provider'
import { useAssetMenu } from '@/components/workbench/use-asset-menu'
import type { WireMusicTrackSource } from '@/lib/music-source-api'
import { MEDIA_ID, MUSIC_TRACK_ID, PROJECT_ID } from './fixtures'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 素材ツリーの楽曲の右クリック「プロンプトを見る」（制作者 2026-10-25）。
 * AI で作った曲（頼み方がある）にだけ出て、押すと共通のプロンプトビューアが開く。
 */

const MADE = MusicTrackId.parse(MUSIC_TRACK_ID)
const BROUGHT = MusicTrackId.parse('01ARZ3NDEKTSV4RRFFQ69G5FE9')

const source: WireMusicTrackSource = {
  prompt: 'city pop, female vocal',
  lyrics: '',
  instrumental: true,
  seed: null,
  durationSec: 60,
  tool: 'ace_step',
  model: null,
  createdAt: new Date('2026-10-25T03:00:00Z'),
}

const api = vi.hoisted(() => ({ listMusicTrackSources: vi.fn() }))
vi.mock('@/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...original, createApiClient: () => api }
})

const track = (id: MusicTrackId, title: string) =>
  MusicTrack.parse({ id, projectId: PROJECT_ID, mediaAssetId: MEDIA_ID, title, isMaster: false, offsetSec: 0, volume: 1 })

const Opener = ({ id }: { readonly id: MusicTrackId }) => {
  const menu = useAssetMenu()
  return (
    <button
      type="button"
      onClick={(event) => {
        menu.open({ kind: 'track', id }, { x: 1, y: 1 }, event.currentTarget)
      }}
    >
      開く
    </button>
  )
}

const setup = async (id: MusicTrackId) => {
  api.listMusicTrackSources.mockResolvedValue(new Map([[MADE, source]]))
  renderInWorkbench(
    <PromptViewerProvider>
      <Opener id={id} />
    </PromptViewerProvider>,
    {},
    { tracks: { state: 'ready', value: [track(MADE, '作った曲'), track(BROUGHT, '持ち込んだ曲')] } },
  )
  // 頼み方を読み終えてから開く。
  await vi.waitFor(() => {
    expect(api.listMusicTrackSources).toHaveBeenCalled()
  })
  await Promise.resolve()
  await userEvent.click(screen.getByRole('button', { name: '開く' }))
}

describe('楽曲の右クリック「プロンプトを見る」', () => {
  it('AI で作った曲では、押すと曲調が出る', async () => {
    await setup(MADE)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'プロンプトを見る' }))
    expect(screen.getByText('city pop, female vocal')).toBeInTheDocument()
  })

  it('持ち込んだ曲には出さない', async () => {
    await setup(BROUGHT)
    expect(screen.getByRole('menu', { name: '持ち込んだ曲 の操作' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'プロンプトを見る' })).toBeNull()
  })
})
