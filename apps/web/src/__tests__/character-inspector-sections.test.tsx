import { Character, CharacterId, ProjectId, WorkspaceId, newId } from '@ixa/domain'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CharacterInspector } from '@/components/workbench/inspector/asset-inspectors'
import { PROJECT_ID } from './fixtures'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * キャラクターのインスペクターも Shot と同じ畳める見出しの行にする（2026-10-26。区切りの見た目を揃える）。
 * 中身は変えない。
 */

const api = vi.hoisted(() => ({ mediaUrl: vi.fn(), listMusicTrackSources: vi.fn(() => Promise.resolve([])) }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

const cat = Character.parse({
  id: newId(CharacterId),
  workspaceId: newId(WorkspaceId),
  projectId: ProjectId.parse(PROJECT_ID),
  name: 'neko',
  displayName: 'ネコ',
  speakerNo: 1,
  createdAt: new Date('2026-10-26T00:00:00.000Z'),
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('CharacterInspector の区切り', () => {
  it('同一性・話し手の伝え方・Look・声は開いた畳める区切りで、押すと畳んで要約を出す', async () => {
    renderInWorkbench(
      <CharacterInspector id={cat.id} />,
      {},
      assetStoreValue({ characters: { state: 'ready', value: [cat] } }),
    )

    for (const name of ['同一性', '話し手の伝え方', 'Look（0）', '声（0）']) {
      const heading = screen.getByRole('heading', { name })
      expect(within(heading).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    }

    await userEvent.click(within(screen.getByRole('heading', { name: '話し手の伝え方' })).getByRole('button'))
    expect(screen.getByRole('heading', { name: '話し手の伝え方（まだ空）' })).toBeInTheDocument()
  })
})
