import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectId } from '@ixa/domain'
import type { RoughCutChange } from '@ixa/timeline'
import { describe, expect, it, vi } from 'vitest'
import { AlignLyricsDialogBody } from '@/components/workbench/dialogs/align-lyrics-dialog'
import type { RoughCutApi } from '@/lib/rough-cut-api'
import { aProject, aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * Shot の境目を歌い出しに揃える（制作者 2026-10-02「歌詞入れて再生してみると、かなり画像と歌詞がずれてる」）。
 * 区切ったのが歌詞に時刻を付ける前だったので、境目が歌い出しより早かった。揃える先は行ごとに人が選ぶ。
 */

// CUT-01 0–4 / CUT-02 4–8 / CUT-03 8–12。歌い出しは 1, 5.5, 6.25, 9.
const shots = [
  aWorkbenchShot(1, { startSec: 0, durationSec: 4, description: '門の前' }),
  aWorkbenchShot(2, { startSec: 4, durationSec: 4, description: '台所で母が話しかける' }),
  aWorkbenchShot(3, { startSec: 8, durationSec: 4, description: '食卓の茶碗' }),
]
const project = { ...aProject, lyrics: 'ぼくは\nただいま\nちゃんと聞いて\nごはん', lyricCues: [1, 5.5, 6.25, 9] }

const fakeApi = (skipped: readonly { reason: string }[] = []): Pick<RoughCutApi, 'applyRoughCut'> => ({
  applyRoughCut: vi.fn((_projectId: ProjectId, changes: readonly RoughCutChange[]) =>
    Promise.resolve({
      applied: [...changes],
      skipped: skipped.map((entry) => ({ change: changes[0]!, reason: entry.reason })),
    }),
  ),
})

const rowOf = (label: string): HTMLElement => {
  const row = screen.getByText(label).closest('li')
  if (row === null) throw new Error(`${label} の行がありません`)
  return row
}

describe('AlignLyricsDialogBody', () => {
  it('境目ごとに今の位置・揃える先（既定はすぐ後の歌い出し）・動き・次の Shot の説明を出す', () => {
    renderInWorkbench(<AlignLyricsDialogBody api={fakeApi()} />, { project, shots })

    const first = rowOf('CUT-01 → CUT-02')
    expect(within(first).getByText('0:04.00')).toBeTruthy()
    expect(within(first).getByRole<HTMLSelectElement>('combobox').value).toBe('5.5')
    expect(within(first).getByText('+1.50s')).toBeTruthy()
    expect(within(first).getByText(/台所で母が話しかける/)).toBeTruthy()
    expect(within(first).getByRole('option', { name: /0:06.25「ちゃんと聞いて」/ })).toBeTruthy()
    expect(within(rowOf('CUT-02 → CUT-03')).getByRole<HTMLSelectElement>('combobox').value).toBe('9')
    expect(screen.getByRole('button', { name: '2 か所を動かす' })).toBeTruthy()
  })

  it('選び直せて、押すと選んだ分だけ粗編集として当て、知らせて読み直す', async () => {
    const api = fakeApi()
    const { value } = renderInWorkbench(<AlignLyricsDialogBody api={api} />, { project, shots })

    await userEvent.selectOptions(within(rowOf('CUT-01 → CUT-02')).getByRole('combobox'), '6.25')
    await userEvent.selectOptions(within(rowOf('CUT-02 → CUT-03')).getByRole('combobox'), '')
    await userEvent.click(screen.getByRole('button', { name: '1 か所を動かす' }))

    await waitFor(() => {
      expect(api.applyRoughCut).toHaveBeenCalledTimes(1)
    })
    expect(api.applyRoughCut).toHaveBeenCalledWith(project.id, [
      expect.objectContaining({ kind: 'trim', shotId: shots[0]!.id, toDurationSec: 6.25 }),
      expect.objectContaining({ kind: 'move', shotId: shots[1]!.id, toSec: 6.25 }),
      expect.objectContaining({ kind: 'trim', shotId: shots[1]!.id, toDurationSec: 1.75 }),
    ])
    expect(value.notify).toHaveBeenCalledWith(expect.stringMatching(/変更の履歴から戻せます/))
    expect(value.refresh).toHaveBeenCalled()
    expect(value.closeDialog).toHaveBeenCalled()
  })

  it('当てられなかった分は理由を出し、閉じない', async () => {
    const api = fakeApi([{ reason: '案を作ったあとに Shot が動いています' }])
    const { value } = renderInWorkbench(<AlignLyricsDialogBody api={api} />, { project, shots })

    await userEvent.click(screen.getByRole('button', { name: '2 か所を動かす' }))

    expect(await screen.findByText(/案を作ったあとに Shot が動いています/)).toBeTruthy()
    expect(value.closeDialog).not.toHaveBeenCalled()
  })

  it('歌詞の時刻が無ければ、理由と「歌詞を合わせる」を出す', async () => {
    const { value } = renderInWorkbench(<AlignLyricsDialogBody api={fakeApi()} />, {
      project: { ...project, lyricCues: [] },
      shots,
    })

    expect(screen.getByText(/歌詞の時刻がまだありません/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '歌詞を合わせる' }))
    expect(value.openCutter).toHaveBeenCalledWith('lyrics')
    expect(value.closeDialog).toHaveBeenCalled()
  })
})
