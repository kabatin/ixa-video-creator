import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkbenchKeys } from '@/components/workbench/use-workbench-keys'
import { CUT_EDITOR_ATTRIBUTE } from '@/lib/playback-state'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * ワークベンチの打鍵の**配線**（判定そのものは `workbench-keys.test.ts`）。
 *
 * ここで見たいのは 2 点。
 * 1. Space が `togglePlayback` に繋がっていること。`toggle` だと、裏で鳴っている
 *    ときに「止める」ではなく「別の場所を鳴らし始める」になる
 * 2. 「聴きながら切る」へ譲るかを**フォーカスの居場所**（`data-cut-editor` の中か）で
 *    決めていること。可視で決めていた頃は既定の配置で Space が一度も効かなかった
 */

const shots = [aWorkbenchShot(1), aWorkbenchShot(2), aWorkbenchShot(3)]

const Probe = ({ undo }: { readonly undo: () => void }) => {
  useWorkbenchKeys({ undo })
  return (
    <div>
      <div data-testid="outside">外</div>
      <div data-cut-editor="" data-testid="cutter">
        <span data-testid="in-cutter">中</span>
        <button type="button" data-testid="cutter-button">
          新規
        </button>
      </div>
    </div>
  )
}

const setup = (patch: Parameters<typeof renderInWorkbench>[1] = {}) => {
  const undo = vi.fn()
  const rendered = renderInWorkbench(<Probe undo={undo} />, {
    shots,
    selectedShotId: shots[1]?.id ?? null,
    ...patch,
  })
  return { undo, ...rendered }
}

const press = (testId: string, key: string): void => {
  fireEvent.keyDown(screen.getByTestId(testId), { key })
}

describe('Space の行き先', () => {
  /**
   * `toggle(owner)` はパネルの再生ボタン用で、鳴っている相手が別でも自分を鳴らし始める。
   * 画面共通の 1 打をそこへ繋ぐと、止めるつもりで曲の違う場所が鳴り出す。
   */
  it('鳴っている持ち主が誰でも止まる口（togglePlayback）に繋がっている', () => {
    const { value } = setup()

    press('outside', ' ')

    expect(value.transportControls.togglePlayback).toHaveBeenCalledWith('monitor')
    expect(value.transportControls.toggle).not.toHaveBeenCalled()
  })
})

describe('聴きながら切るへ譲るか', () => {
  it('フォーカスが入れ物の外なら、ワークベンチが受ける', () => {
    const { value } = setup()

    press('outside', ' ')
    press('outside', 'ArrowRight')

    expect(value.transportControls.togglePlayback).toHaveBeenCalledTimes(1)
    expect(value.selectShot).toHaveBeenCalledWith(shots[2]?.id)
  })

  it('フォーカスが入れ物の中なら、1 つも受けない', () => {
    const { value } = setup()

    press('in-cutter', ' ')
    press('in-cutter', 'ArrowLeft')
    press('in-cutter', 'ArrowRight')

    expect(value.transportControls.togglePlayback).not.toHaveBeenCalled()
    expect(value.selectShot).not.toHaveBeenCalled()
  })

  it('入れ物の中のボタンの上でも受けない（ボタンの打鍵）', () => {
    const { value } = setup()

    press('cutter-button', ' ')

    expect(value.transportControls.togglePlayback).not.toHaveBeenCalled()
  })

  it('目印は 1 か所の定数から引く', () => {
    setup()

    expect(screen.getByTestId('cutter')).toHaveAttribute(CUT_EDITOR_ATTRIBUTE)
  })
})

describe('Shot の移動', () => {
  it('← → で隣の Shot を選ぶ', () => {
    const { value } = setup()

    press('outside', 'ArrowLeft')

    expect(value.selectShot).toHaveBeenCalledWith(shots[0]?.id)
  })
})

describe('受けない場面', () => {
  it('ダイアログを開いている間は何も受けない', () => {
    const { value, undo } = setup({ dialog: 'history' })

    press('outside', ' ')
    press('outside', 'ArrowRight')
    fireEvent.keyDown(screen.getByTestId('outside'), { key: 'z', metaKey: true })

    expect(value.transportControls.togglePlayback).not.toHaveBeenCalled()
    expect(value.selectShot).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
  })

  it('⌘Z はフォーカスが入れ物の中でもワークベンチのもの', () => {
    const { undo } = setup()

    fireEvent.keyDown(screen.getByTestId('in-cutter'), { key: 'z', metaKey: true })

    expect(undo).toHaveBeenCalledTimes(1)
  })
})
