import { Location, MusicTrack, MusicTrackId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewerPanel } from '@/components/workbench/panels/viewer-panel'
import { SoloAudioProvider } from '@/components/workbench/solo-audio'
import { WireVoice } from '@/lib/narration-api'
import { PROJECT_ID, WORKSPACE_ID } from './fixtures'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 素材ビューアで「見て・聴いて確かめる」（制作者 2026-10-17）。
 * - 画像は切り取らず、押すと大きく出る（← → で前後、Esc で閉じる）
 * - 楽曲はその場で鳴らせる
 * - 声は一文を読ませて聴ける
 */

vi.mock('@/components/media-image', () => ({
  MediaImage: ({ alt }: { readonly alt: string }) => <span>{`画像:${alt}`}</span>,
}))

const api = vi.hoisted(() => ({
  getAnalysis: vi.fn(),
  mediaUrl: vi.fn(),
  previewVoice: vi.fn(),
  getVoiceJob: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

const aLocation = Location.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FC2',
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  name: '体育館',
  description: '',
  referenceAssetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FC5', '01ARZ3NDEKTSV4RRFFQ69G5FC6'],
})

const aTrack = MusicTrack.parse({
  id: MusicTrackId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC7'),
  projectId: PROJECT_ID,
  mediaAssetId: '01ARZ3NDEKTSV4RRFFQ69G5FC8',
  title: 'NIGHT RUN',
  isMaster: true,
  offsetSec: 0,
  volume: 1,
})

const aVoice = WireVoice.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FD2',
  projectId: PROJECT_ID,
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

beforeEach(() => {
  vi.clearAllMocks()
  api.getAnalysis.mockResolvedValue(null)
  api.mediaUrl.mockResolvedValue({ url: 'https://example.invalid/a.wav', expiresInSec: 3600 })
})

describe('画像を大きく見る', () => {
  it('押すと大きく出し、→ で次へ、Esc で閉じる', async () => {
    const user = userEvent.setup()
    renderInWorkbench(<ViewerPanel />, { inspected: { kind: 'location', id: aLocation.id } }, {
      locations: { state: 'ready', value: [aLocation] },
    })

    await user.click(screen.getByRole('button', { name: '参照 1を大きく見る' }))
    expect(screen.getByRole('dialog', { name: '参照 1' })).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: '参照 2' })).toHaveTextContent('2 / 2')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('音を聴く', () => {
  // 鳴らすのはワークベンチに 1 つの再生器（素材ビューアとインスペクターが同じ `<audio>` を使う）。
  it('楽曲はその場で鳴らせる（URL は期限を付けて取る）', async () => {
    renderInWorkbench(
      <SoloAudioProvider>
        <ViewerPanel />
      </SoloAudioProvider>,
      { inspected: { kind: 'track', id: aTrack.id } },
      {
        tracks: { state: 'ready', value: [aTrack] },
      },
    )

    expect(await screen.findByRole('region', { name: 'NIGHT RUN の再生操作' })).toBeInTheDocument()
    await waitFor(() => {
      expect(api.mediaUrl).toHaveBeenCalledWith(aTrack.mediaAssetId, 3600)
    })
  })

  it('声は素材ビューアに出し、一文を読ませて聴ける', () => {
    renderInWorkbench(<ViewerPanel />, { inspected: { kind: 'voice', id: aVoice.id } }, {
      voices: { state: 'ready', value: [aVoice] },
    })

    expect(screen.getByRole('heading', { name: 'ナレーター' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '試しに読む' })).toBeInTheDocument()
  })
})
