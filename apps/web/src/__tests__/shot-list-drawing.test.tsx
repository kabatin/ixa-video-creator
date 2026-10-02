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
  [drawing.id, { url: null, reason: '絵コンテの画像を作っています', hasStartFrame: false, pending: true }],
  [idle.id, { url: null, reason: 'まだ Take がありません', hasStartFrame: false, pending: false }],
])

const rowOf = (code: string): HTMLElement => {
  const row = screen.getByRole('rowheader', { name: code }).closest('tr')
  if (row === null) throw new Error(`${code} の行がありません`)
  return row
}

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
