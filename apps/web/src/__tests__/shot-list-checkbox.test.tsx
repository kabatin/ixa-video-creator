import { Shot, ShotId, type ShotId as ShotIdType } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ShotListCompact } from '@/components/workbench/shot-list-compact'
import { headerCheckboxState, toggleShot, type ShotSelection } from '@/lib/shot-bulk'
import { shotJson } from './fixtures'

/**
 * Shot 一覧のチェック。**押したその場で見た目が変わる**こと。
 *
 * チェックボックスの押下で既定の動き（preventDefault）を止めていたため、ブラウザが押す前の見た目に戻し、
 * 次に描き直す（行を押す）まで古いチェックのまま見えていた（制作者の指摘 2026-09-30）。
 */

const aShot = (index: number): Shot =>
  Shot.parse({
    ...shotJson,
    id: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2, '0')}`),
    code: `shot_${String(index).padStart(3, '0')}`,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
  })

const SHOTS = [aShot(1), aShot(2), aShot(3)]

/** 実画面と同じく、チェックの集合は親が持つ。 */
const List = ({ onRange }: { readonly onRange?: (shotId: ShotIdType, range: boolean) => void }) => {
  const [checked, setChecked] = useState<ShotSelection>(new Set<ShotIdType>())
  return (
    <ShotListCompact
      shots={SHOTS}
      posters={new Map()}
      selectedShotId={null}
      checked={checked}
      headerState={headerCheckboxState(
        checked,
        SHOTS.map((shot) => shot.id),
      )}
      busy={false}
      sort={{ key: 'order', direction: 'asc' }}
      onSort={() => undefined}
      onSelect={() => undefined}
      onToggle={(shotId, range) => {
        onRange?.(shotId, range)
        setChecked((current) => toggleShot(current, shotId))
      }}
      onToggleAll={() => undefined}
      numberOf={(shotId) => SHOTS.findIndex((shot) => shot.id === shotId) + 1}
      alignmentOf={() => undefined}
      showBeat={false}
    />
  )
}

const box = (code: string) =>
  screen.getByRole('checkbox', { name: `${code} を一括操作の対象にする` })

describe('Shot 一覧のチェック', () => {
  it('押したその場でチェックが付き、もう一度押すと外れる', async () => {
    render(<List />)

    await userEvent.click(box('shot_002'))
    expect(box('shot_002')).toBeChecked()

    await userEvent.click(box('shot_002'))
    expect(box('shot_002')).not.toBeChecked()
  })

  it('キーボード（Space）でも、その場で切り替わる', async () => {
    render(<List />)

    box('shot_001').focus()
    await userEvent.keyboard(' ')

    expect(box('shot_001')).toBeChecked()
  })

  it('Shift を押しながら押すと、範囲選択として知らせる', async () => {
    const onRange = vi.fn()
    // 押しっぱなしの Shift を次の操作へ持ち越すため、同じ user で続けて操作する。
    const user = userEvent.setup()
    render(<List onRange={onRange} />)

    await user.click(box('shot_001'))
    await user.keyboard('{Shift>}')
    await user.click(box('shot_003'))
    await user.keyboard('{/Shift}')

    expect(onRange).toHaveBeenNthCalledWith(1, SHOTS[0]?.id, false)
    expect(onRange).toHaveBeenNthCalledWith(2, SHOTS[2]?.id, true)
  })

  /** 状態の「生成中」だけでは分からなかった（制作者 2026-09-30）。一覧にも経過を出す。 */
  it('生成中の Shot の状態の横に、様子を短く出す', () => {
    const generating = [aShot(1), { ...aShot(2), status: 'generating' as const }]
    render(
      <ShotListCompact
        shots={generating}
        posters={new Map()}
        selectedShotId={null}
        checked={new Set()}
        headerState="none"
        busy={false}
        sort={{ key: 'order', direction: 'asc' }}
        onSort={() => undefined}
        onSelect={() => undefined}
        onToggle={() => undefined}
        onToggleAll={() => undefined}
        numberOf={() => 1}
        alignmentOf={() => undefined}
        showBeat={false}
        activityOf={(shotId) => (shotId === generating[1]?.id ? '作成中 0:42' : null)}
      />,
    )

    expect(screen.getByText('作成中 0:42')).toBeInTheDocument()
  })
})

