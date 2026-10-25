import { Character, CharacterId, ProjectId, WorkspaceId, newId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShotDialogueSection } from '@/components/workbench/inspector/shot-dialogue-section'
import { PROJECT_ID } from './fixtures'
import { aWorkbenchShot, assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * Shot のセリフの欄（ADR-0059）。行を足してセリフを書くと保存する。話し手は配役の人が先。
 * 呼び名や声の説明が無い話し手と、長すぎるセリフは、作る前にここで知らせる。
 */

const api = vi.hoisted(() => ({ listShotCast: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

const person = (name: string, speakerNo: number, voiced: boolean) =>
  Character.parse({
    id: newId(CharacterId),
    workspaceId: newId(WorkspaceId),
    projectId: ProjectId.parse(PROJECT_ID),
    name,
    displayName: name,
    speakerNo,
    ...(voiced ? { speechName: 'The cat', voiceDescription: 'a soft voice' } : {}),
    createdAt: new Date('2026-10-26T00:00:00.000Z'),
  })

const cat = person('ネコ', 1, true)
const mouse = person('ネズミ', 2, false)

const render = (shot = aWorkbenchShot(1), onSave = vi.fn(() => Promise.resolve())) => {
  renderInWorkbench(
    <ShotDialogueSection shot={shot} version={0} disabled={false} onSave={onSave} />,
    {},
    assetStoreValue({ characters: { state: 'ready', value: [cat, mouse] } }),
  )
  return onSave
}

beforeEach(() => {
  api.listShotCast.mockReset().mockResolvedValue([{ characterId: mouse.id }])
})

describe('ShotDialogueSection', () => {
  it('行を足してセリフを書くと、欄を離れたときに保存する。話し手は配役の人が先', async () => {
    const onSave = render()
    await userEvent.click(screen.getByRole('button', { name: '＋ セリフを足す' }))
    const speaker = await screen.findByRole('combobox', { name: '1 行目の話し手' })
    await waitFor(() => {
      expect((speaker as HTMLSelectElement).value).toBe(mouse.id)
    })
    await userEvent.selectOptions(speaker, cat.id)
    // セリフが空のうちは保存しない（domain が空のセリフを拒む）
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox', { name: '1 行目のセリフ' }), 'ねえ、ネズミくん。')
    await userEvent.tab()

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        dialogue: [{ speakerId: cat.id, text: 'ねえ、ネズミくん。', offscreen: false, translation: null }],
      })
    })
  })

  it('呼び名と声の説明が無い話し手を知らせる', () => {
    render(aWorkbenchShot(1, { dialogue: [{ speakerId: mouse.id, text: 'なに？', offscreen: false, translation: null }] }))
    expect(screen.getByText('セリフの話し手「ネズミ」に英語の呼び名がありません')).toBeTruthy()
    expect(screen.getByText('セリフの話し手「ネズミ」に声の説明（英語）がありません')).toBeTruthy()
  })

  it('5 行以上は長すぎると警告する', () => {
    const lines = Array.from({ length: 5 }, () => ({ speakerId: cat.id, text: 'あ', offscreen: false, translation: null }))
    render(aWorkbenchShot(1, { dialogue: lines }))
    expect(screen.getByText('長すぎます（10 秒に 3〜4 行まで）')).toBeTruthy()
  })
})
