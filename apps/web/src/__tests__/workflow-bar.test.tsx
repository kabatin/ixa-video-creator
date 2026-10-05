import { ShotId, type MusicTrack } from '@ixa/domain'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { WorkflowBar } from '@/components/workbench/workflow-bar'
import { WorkflowProvider } from '@/components/workbench/workflow-context'
import type { WorkbenchContextValue } from '@/components/workbench/workbench-context'
import type { ShotPosterMap } from '@/lib/shot-posters'
import { aProject, aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * 制作の流れの帯（制作者 2026-10-01「上部に流れの帯」）。済んだ所に ✓、途中は件数、次にやる所を目立たせ、
 * 押すとその作業の画面へ。2026-10-03 に 9 段へ並べ直した（テロップを区切る前に、最後に書き出す）。
 */

const track = { id: 'track-1', title: 'iXA CUP' } as unknown as MusicTrack
const LYRICS = '一行目\n二行目\n三行目'

const postersFor = (ids: readonly string[], withFrame: readonly boolean[]): ShotPosterMap =>
  new Map(
    ids.map((id, index) => [
      ShotId.parse(id),
      { url: null, reason: 'まだ Take がありません', hasStartFrame: withFrame[index] ?? false, drawing: false, pending: false },
    ]),
  )

const show = (
  patch: Partial<WorkbenchContextValue>,
  flow: { lyricTelopCount?: number | null; rendered?: boolean | null; narration?: { lines: number; ready: number } | null } = {},
): ReturnType<typeof renderInWorkbench> => {
  const ui: ReactElement = (
    <WorkflowProvider lyricTelopCount={flow.lyricTelopCount ?? 0} narration={flow.narration ?? null} rendered={flow.rendered ?? false}>
      <WorkflowBar />
    </WorkflowProvider>
  )
  return renderInWorkbench(ui, patch)
}

/** 方針・歌詞・ルックが済み、歌詞の時刻も付いている作品。 */
const ready = (patch: Partial<WorkbenchContextValue> = {}): Partial<WorkbenchContextValue> => ({
  track,
  concept: '夜明け',
  project: { ...aProject, lyrics: LYRICS, lyricCues: [1, 2, 3], styleGuide: '水彩' },
  ...patch,
})

describe('WorkflowBar', () => {
  it('楽曲が無ければ ① 楽曲が次。押すと楽曲の登録のしかたを言う', async () => {
    const { value } = show({ track: null })

    const music = screen.getByRole('button', { name: /① 楽曲/ })
    expect(music).toHaveAttribute('aria-current', 'step')
    await userEvent.click(music)
    expect(value.focusPanel).toHaveBeenCalledWith('assets')
    expect(value.notify).toHaveBeenCalledWith(expect.stringContaining('楽曲がまだありません'))
  })

  it('ルックが空なら ② 作品の方針が途中（2/3）で次。押すと作品の方針を開く', async () => {
    const { value } = show(ready({ project: { ...aProject, lyrics: LYRICS, lyricCues: [], styleGuide: '' } }))

    const concept = screen.getByRole('button', { name: /② 作品の方針/ })
    expect(concept).toHaveTextContent('2/3')
    expect(concept).toHaveAttribute('aria-current', 'step')
    await userEvent.click(concept)
    expect(value.inspect).toHaveBeenCalledWith({ kind: 'project', id: value.projectId })
    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
  })

  it('歌詞の時刻が途中なら ③ が次（件数）。押すと聴きながら切るを歌詞のモードで開く', async () => {
    const { value } = show(ready({ project: { ...aProject, lyrics: LYRICS, lyricCues: [1], styleGuide: '水彩' } }))

    const lyrics = screen.getByRole('button', { name: /③ 歌詞の時刻/ })
    expect(lyrics).toHaveTextContent('1/3')
    expect(lyrics).toHaveAttribute('aria-current', 'step')
    await userEvent.click(lyrics)
    expect(value.openCutter).toHaveBeenCalledWith('lyrics')
  })

  it('時刻が付いてテロップが無ければ ④ テロップが次。押すと歌詞のモードを開く（そこでテロップにする）', async () => {
    const { value } = show(ready(), { lyricTelopCount: 0 })

    const telops = screen.getByRole('button', { name: /④ テロップ/ })
    expect(telops).toHaveAttribute('aria-current', 'step')
    await userEvent.click(telops)
    expect(value.openCutter).toHaveBeenCalledWith('lyrics')
  })

  it('⑤ ナレーションは、声を作って置いた行を数え、押すとナレーションのパネルを開く（ADR-0038）', async () => {
    const { value } = show(ready(), { lyricTelopCount: 3, narration: { lines: 3, ready: 1 } })
    const narration = screen.getByRole('button', { name: /⑤ ナレーション/ })

    expect(narration).toHaveTextContent('1/3')
    await userEvent.click(narration)
    expect(value.focusPanel).toHaveBeenCalledWith('narration')
  })

  it('テロップまで済んで Shot が無ければ ⑥ 区切って Shot が次。押すと区切るモードで開く', async () => {
    const { value } = show(ready({ shots: [] }), { lyricTelopCount: 3 })

    const shots = screen.getByRole('button', { name: /⑥ 区切って Shot/ })
    expect(shots).toHaveAttribute('aria-current', 'step')
    await userEvent.click(shots)
    expect(value.openCutter).toHaveBeenCalledWith('cut')
  })

  it('歌詞が無ければ ③ と ④ は「—」', () => {
    show({ track, concept: '夜明け', project: { ...aProject, lyrics: '' } })

    expect(screen.getByRole('button', { name: /③ 歌詞の時刻/ })).toHaveTextContent('—')
    expect(screen.getByRole('button', { name: /④ テロップ/ })).toHaveTextContent('—')
  })

  it('絵コンテ・絵・Take は件数を出し、押すとその作業の画面へ。⑩ 書き出すは書き出しの画面を開く', async () => {
    const shots = [
      aWorkbenchShot(1, { description: '屋上', selectedTakeId: null }),
      aWorkbenchShot(2, { description: '', selectedTakeId: null }),
    ]
    const { value } = show(
      ready({
        shots,
        posters: postersFor(
          shots.map((shot) => shot.id),
          [true, false],
        ),
      }),
      { lyricTelopCount: 3 },
    )

    expect(screen.getByRole('button', { name: /⑦ 絵コンテ/ })).toHaveTextContent('1/2')
    expect(screen.getByRole('button', { name: /⑧ 絵/ })).toHaveTextContent('1/2')
    expect(screen.getByRole('button', { name: /⑨ Take/ })).toHaveTextContent('0/2')
    expect(screen.getByRole('button', { name: /⑦ 絵コンテ/ })).toHaveAttribute('aria-current', 'step')

    await userEvent.click(screen.getByRole('button', { name: /⑦ 絵コンテ/ }))
    expect(value.focusPanel).toHaveBeenCalledWith('draft')
    await userEvent.click(screen.getByRole('button', { name: /⑨ Take/ }))
    expect(value.focusPanel).toHaveBeenCalledWith('shots')
    await userEvent.click(screen.getByRole('button', { name: /⑩ 書き出す/ }))
    expect(value.openDialog).toHaveBeenCalledWith('render')
  })
})
