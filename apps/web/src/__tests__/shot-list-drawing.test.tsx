import { Shot, ShotId } from '@ixa/domain'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShotListCompact } from '@/components/workbench/shot-list-compact'
import { EMPTY_SELECTION, headerCheckboxState } from '@/lib/shot-bulk'
import type { ShotPosterMap } from '@/lib/shot-posters'
import { shotJson } from './fixtures'

/**
 * Shot 一覧で、絵を作っている Shot のサムネに回る印を出す
 * （制作者 2026-10-02「画像生成中のところはサムネのところに生成中なのが分かるようにローディングマーク」）。
 */

const aShot = (index: number): Shot =>
  Shot.parse({
    ...shotJson,
    id: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2, '0')}`),
    code: `CUT-${String(index).padStart(2, '0')}`,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
  })

const drawing = aShot(1)
const idle = aShot(2)
const SHOTS = [drawing, idle]

const posters: ShotPosterMap = new Map([
  [drawing.id, { url: null, reason: '絵コンテの画像を作っています', hasStartFrame: false, drawing: true, pending: true }],
  [idle.id, { url: null, reason: 'まだ Take がありません', hasStartFrame: false, drawing: false, pending: false }],
])

const rowOf = (code: string): HTMLElement => {
  const row = screen.getByRole('rowheader', { name: code }).closest('tr')
  if (row === null) throw new Error(`${code} の行がありません`)
  return row
}

const show = (map: ShotPosterMap, activityOf?: (shotId: ShotId) => string | null) =>
  render(
    <ShotListCompact
      shots={SHOTS}
      posters={map}
      selectedShotId={null}
      checked={EMPTY_SELECTION}
      headerState={headerCheckboxState(EMPTY_SELECTION, SHOTS.map((shot) => shot.id))}
      busy={false}
      sort={{ key: 'start', direction: 'asc' }}
      onSort={() => undefined}
      onSelect={() => undefined}
      onToggle={() => undefined}
      onToggleAll={() => undefined}
      numberOf={(shotId) => SHOTS.findIndex((shot) => shot.id === shotId) + 1}
      alignmentOf={() => undefined}
      showBeat={false}
      {...(activityOf === undefined ? {} : { activityOf })}
    />,
  )

/**
 * 作っているものを形で分ける（制作者 2026-10-03「Shot 一覧もぐるぐる表示したほうがいいが、画像と動画で見た目は
 * 切り替えたほうがよさそう」）。絵は「絵を作っています」、動画は「動画」と経過を、回る印つきで出す。
 */
describe('Shot 一覧の作っている印', () => {
  it('絵を作っている Shot には、絵の印を出す', () => {
    show(posters)
    const badge = within(rowOf('CUT-01')).getByRole('status')
    expect(badge).toHaveAttribute('data-kind', 'image')
    expect(badge).toHaveTextContent('絵を作っています')
    expect(within(rowOf('CUT-02')).queryByRole('status')).toBeNull()
  })

  it('動画を作っている Shot には、動画の印と経過を出す', () => {
    show(posters, (shotId) => (shotId === idle.id ? '作成中 2:31 / 約 4 分' : null))
    const badge = within(rowOf('CUT-02')).getByRole('status')
    expect(badge).toHaveAttribute('data-kind', 'video')
    expect(badge).toHaveTextContent('動画 作成中 2:31 / 約 4 分')
  })

  it('採用 Take があっても、絵を作っている間は絵の印を出す', () => {
    show(
      new Map([
        [drawing.id, { url: 'https://example.invalid/take.jpg', reason: null, hasStartFrame: true, drawing: true, pending: false }],
        [idle.id, { url: null, reason: 'まだ Take がありません', hasStartFrame: false, drawing: false, pending: false }],
      ]),
    )
    expect(within(rowOf('CUT-01')).getByRole('status')).toHaveAttribute('data-kind', 'image')
  })
})

describe('Shot 一覧のサムネ', () => {
  it('絵を作っている Shot にだけ回る印を出す', () => {
    render(
      <ShotListCompact
        shots={SHOTS}
        posters={posters}
        selectedShotId={null}
        checked={EMPTY_SELECTION}
        headerState={headerCheckboxState(EMPTY_SELECTION, SHOTS.map((shot) => shot.id))}
        busy={false}
        sort={{ key: 'start', direction: 'asc' }}
        onSort={() => undefined}
        onSelect={() => undefined}
        onToggle={() => undefined}
        onToggleAll={() => undefined}
        numberOf={(shotId) => SHOTS.findIndex((shot) => shot.id === shotId) + 1}
        alignmentOf={() => undefined}
        showBeat={false}
      />,
    )

    expect(within(rowOf('CUT-01')).getByTestId('poster-spinner')).toBeInTheDocument()
    expect(
      within(rowOf('CUT-01')).getByRole('img', { name: 'CUT-01 のサムネイル: 絵コンテの画像を作っています' }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(within(rowOf('CUT-02')).queryByTestId('poster-spinner')).toBeNull()
  })
})
