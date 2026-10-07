import { ModelId } from '@ixa/domain'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import {
  BulkActionBar,
  type BulkActionBarProps,
  type BulkUpdatePatch,
} from '@/components/bulk-action-bar'

/**
 * 貼り付く操作バーを実際に描画して確かめる。
 *
 * この部品が守っているのは 3 つ。
 * 1. **課金は 1 回押しただけでは起きない**（27 件分の生成は取り消せない）
 * 2. **触っていない項目を送らない**（27 件の mood が黙って消えない / lessons L-015）
 * 3. **キーボードだけで閉じられ、現在地を失わない**（lessons L-022）
 *
 * 3 は `document.activeElement` では確かめられない。jsdom が勝手に焦点を動かすため、
 * 最終状態からは「戻したのか、たまたまそこにいるのか」が読めない。
 * **`focus()` の呼び出しそのものを見る。**
 */

const MODEL_OPTIONS = [
  { value: 'AUTO' as const, label: 'AUTO（ルーターに任せる）' },
  { value: ModelId.parse('veo-3'), label: 'Veo 3' },
]

const CAMERA_SIZE_OPTIONS = [
  { value: 'wide', label: 'ワイド' },
  { value: 'closeup', label: 'クローズアップ' },
]

/** 空文字は `lib/location-options` の「なし」。**「変えない」と混ぜないこと。** */
const LOCATION_OPTIONS = [
  { value: '', label: 'なし' },
  { value: 'loc-1', label: '倉庫（参照画像 2 枚）' },
]

const baseProps = (overrides: Partial<BulkActionBarProps> = {}): BulkActionBarProps => ({
  selectedCount: 12,
  alreadySelectedCount: 0,
  lockedCount: 0,
  unguidedCount: 0,
  missingCameraCount: 0,
  modelOptions: MODEL_OPTIONS,
  cameraSizeOptions: CAMERA_SIZE_OPTIONS,
  locationOptions: LOCATION_OPTIONS,
  /** **事前見積は API から取れない。** 呼び出し元も null を渡す（F3a）。 */
  estimatedTotalUsd: null,
  busy: false,
  progress: null,
  outcome: null,
  onGenerate: vi.fn(),
  onSelectTakes: vi.fn(),
  onUpdate: vi.fn(),
  onClearSelection: vi.fn(),
  onDelete: vi.fn(),
  onMerge: vi.fn(),
  onRender: vi.fn(),
  onDrawStartFrames: vi.fn(),
  drawWarning: null,
  ...overrides,
})

const setup = (
  overrides: Partial<BulkActionBarProps> = {},
): {
  readonly props: BulkActionBarProps
  readonly user: ReturnType<typeof userEvent.setup>
} => {
  const props = baseProps(overrides)
  render(
    <ContextMenuHost>
      <BulkActionBar {...props} />
    </ContextMenuHost>,
  )
  return { props, user: userEvent.setup() }
}

/** あまり使わない操作は「その他」の中にある（制作者 2026-10-03「メニューが混みあっていて改行してしまう」）。 */
const MORE = 'その他'
const pick = async (user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> => {
  const direct = screen.queryByRole('button', { name })
  if (direct !== null) {
    await user.click(direct)
    return
  }
  await user.click(screen.getByRole('button', { name: MORE }))
  await user.click(screen.getByRole('menuitem', { name }))
}

/** 最後に `onUpdate` へ渡された patch。**キーの有無まで見たいので型を落とさない。** */
const lastPatch = (onUpdate: BulkActionBarProps['onUpdate']): BulkUpdatePatch => {
  const spy = vi.mocked(onUpdate)
  const call = spy.mock.calls.at(-1)
  if (call === undefined) throw new Error('onUpdate が呼ばれていない')
  return call[0]
}

describe('BulkActionBar — 出る / 出ない', () => {
  it('選択が 0 件のときは操作のバーを出さない', () => {
    setup({ selectedCount: 0 })

    expect(screen.queryByRole('region', { name: '一括操作' })).toBeNull()
  })

  /** Take をどこで作るか迷った（制作者 2026-09-30）。チェックしないと一括の操作があることすら見えなかった。 */
  it('選択が 0 件のときは、チェックすればまとめて Take を作れると 1 行で言う', () => {
    setup({ selectedCount: 0 })

    expect(screen.getByText(/チェックを付けると、まとめて絵や Take を作れます/)).toBeInTheDocument()
  })

  /**
   * 1 行にまとめ、よく使う 2 つ（絵・Take）だけを出す。残りは「その他」（制作者 2026-10-03「「1 件を選択中」「選択を解除」
   * 「結合…」「書き出す…」「削除…」が混みあっていて、すべて改行してしまっている」）。文字は折り返さない。
   */
  it('選ばれていれば、件数・解除・絵を作る・Take を作る・その他を 1 行に出す（折り返さない）', () => {
    setup({ selectedCount: 12 })

    const bar = screen.getByRole('region', { name: '一括操作' })
    expect(within(bar).getByText('12 件')).toBeInTheDocument()
    for (const name of ['選択を解除', '絵を作る', 'Take を作る', 'その他']) {
      const button = within(bar).getByRole('button', { name })
      expect(button.className).toContain('whitespace-nowrap')
    }
    expect(screen.queryByRole('button', { name: '結合…' })).toBeNull()
  })

  it('「その他」に、一括採用・一括で変える・結合・書き出す・削除がある', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'その他' }))

    const more = screen.getByRole('menu', { name: 'その他' })
    expect(within(more).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      '一括採用…',
      '一括で変える…',
      '結合…',
      '書き出す…',
      '削除…',
    ])
  })

  /** 一覧の下端に貼り付けて重ねる（制作者 2026-10-03「リストの縦位置が下がってずれて地味に不便」）。 */
  it('一覧の下端に貼り付く', () => {
    setup()
    expect(screen.getByRole('region', { name: '一括操作' }).className).toContain('bottom-0')
  })

  it('開くのは 1 つだけ。別を開くと前が閉じる', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))
    expect(screen.getByRole('group', { name: 'Take を作る' })).toBeInTheDocument()

    await pick(user, '一括で変える…')

    expect(screen.queryByRole('group', { name: 'Take を作る' })).toBeNull()
    expect(screen.getByRole('group', { name: '一括で変える' })).toBeInTheDocument()
  })

  /**
   * 実行中も**画面を止めない**（制作者 2026-10-03「動画生成中、長時間ダイアログ表示で動けなくなるのはなんとかしたい」）。
   * 進み具合はバーの中に数えて出す。生成は worker が続けるので、ほかの作業をしてよい。
   */
  it('実行中は進み具合をバーに出し、画面全体を止めるダイアログは出さない', () => {
    setup({ busy: true })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.getByRole('status')).toHaveTextContent('依頼を送っています')
    expect(screen.getByRole('button', { name: 'Take を作る' })).toBeDisabled()
  })

  it('投入したあとも、終わった件数を数えて見せる。閉じても作り続けると言う', () => {
    setup({ busy: false, progress: { done: 3, total: 8 } })

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '38')
    expect(screen.getByRole('status')).toHaveTextContent('3 / 8 件 終わりました')
    expect(screen.getByRole('status')).toHaveTextContent('ほかの作業をしていて構いません')
  })

  it('選択を外しても、進み具合は出し続ける', () => {
    setup({ selectedCount: 0, busy: false, progress: { done: 1, total: 4 } })

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })

  it('走っていなければ進み具合は出ない', () => {
    setup({ busy: false })

    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('選択の解除はそのまま呼ぶ', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '選択を解除' }))

    expect(props.onClearSelection).toHaveBeenCalledTimes(1)
  })

  /** チェックした Shot をまとめて消す口（制作者の要望 2026-09-26）。確認は開いた先が取る。 */
  it('削除はそのまま呼ぶ（すぐには消さない）', async () => {
    const { props, user } = setup()

    await pick(user, '削除…')

    expect(props.onDelete).toHaveBeenCalledTimes(1)
  })

  /** 隣り合う Shot を先頭にまとめる（ADR-0024）。確認は開いた先が取る。 */
  it('結合はそのまま呼ぶ（すぐにはまとめない）', async () => {
    const { props, user } = setup()

    await pick(user, '結合…')

    expect(props.onMerge).toHaveBeenCalledTimes(1)
  })

  /** チェックした Shot だけを書き出す（制作者 2026-10-02「途中までを誰かに見せたい時のために選択した Shot だけを動画として出力」）。 */
  it('書き出すは書き出しの画面を開く', async () => {
    const { props, user } = setup()

    await pick(user, '書き出す…')

    expect(props.onRender).toHaveBeenCalledTimes(1)
  })
})

describe('BulkActionBar — 一括生成は 2 段階', () => {
  it('1 回押しただけでは依頼しない。確認してから呼ぶ', async () => {
    const { props, user } = setup({ selectedCount: 12 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))

    expect(props.onGenerate).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('費用が掛かります')

    await user.click(screen.getByRole('button', { name: '依頼する' }))

    expect(props.onGenerate).toHaveBeenCalledTimes(1)
    expect(props.onGenerate).toHaveBeenCalledWith({ model: 'AUTO', count: 1 })
  })

  /**
   * **依頼したらフォームを閉じる。** 閉じないと「12 件に生成を依頼」が押せる状態のまま残り、
   * 実 Provider では同じ 12 件に二重に課金される（実機で残っていた）。
   */
  it('依頼したらフォームを閉じ、依頼ボタンを残さない', async () => {
    const { user } = setup({ selectedCount: 12 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))
    await user.click(screen.getByRole('button', { name: '依頼する' }))

    expect(screen.queryByRole('button', { name: '12 件に生成を依頼' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Take を作る' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('選んだモデルと本数がそのまま渡る', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))
    await user.selectOptions(screen.getByLabelText('モデル'), 'veo-3')
    await user.selectOptions(screen.getByLabelText('本数'), '3')
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))
    await user.click(screen.getByRole('button', { name: '依頼する' }))

    expect(props.onGenerate).toHaveBeenCalledWith({ model: 'veo-3', count: 3 })
  })

  it('ロックされた件は数に入れず、理由を出す', async () => {
    const { user } = setup({ selectedCount: 10, lockedCount: 3 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.getByRole('button', { name: '7 件に生成を依頼' })).toBeEnabled()
    expect(screen.getByText('3 件はロックされているため、生成されません。')).toBeInTheDocument()
  })

  /** 制作者 2026-10-01「全然関係ない動画が生成されてしまう」。止めはせず、押す前に件数を言う。 */
  it('説明も最初のフレームも無い Shot が混ざっていれば、件数を出して確認でも言う', async () => {
    const { user } = setup({ selectedCount: 12, unguidedCount: 4 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))
    expect(screen.getByText(/うち 4 件は説明も最初のフレームも無く/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('うち 4 件は説明も最初のフレームも無く')
  })

  it('全部に説明か最初のフレームがあれば、何も言わない', async () => {
    const { user } = setup({ selectedCount: 12, unguidedCount: 0 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.queryByText(/説明も最初のフレームも無く/)).toBeNull()
  })

  /** カメラの動きが未指定だと、動く Shot で顔が画面の外へ出る（ADR-0042 の実測）。止めはしない。 */
  it('カメラの動きが決まっていない Shot が混ざっていれば、押す前に件数を言う', async () => {
    const { user } = setup({ selectedCount: 12, missingCameraCount: 4 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.getByText(/うち 4 件はカメラの動きが決まっていません/)).toBeInTheDocument()
  })

  it('全部決まっていれば、カメラのことは言わない', async () => {
    const { user } = setup({ selectedCount: 12, missingCameraCount: 0 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.queryByText(/カメラの動きが決まっていません/)).toBeNull()
  })

  it('全件ロックなら依頼できない', async () => {
    const { user } = setup({ selectedCount: 3, lockedCount: 3 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.getByRole('button', { name: '0 件に生成を依頼' })).toBeDisabled()
    expect(screen.getByText('生成できる Shot が選ばれていません。')).toBeInTheDocument()
  })

  /**
   * **以前はここが「何も出さない」を正としていた**（F3a）。
   * そのせいで、金額が伏せられたまま「取り消せません」を押させる形が
   * テストで固定されていた。出せないものは「出せない」と書く（lessons L-015）。
   */
  it('見積が取れないときは、取れないと書く', async () => {
    const { user } = setup({ estimatedTotalUsd: null })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.getByText(/合計の見積: いまは投入する前に出せません/)).toBeInTheDocument()
  })

  it('見積 0 は「未取得」と混ぜず、0 として出す', async () => {
    const { user } = setup({ estimatedTotalUsd: 0 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.getByText('合計の見積: $0.00')).toBeInTheDocument()
  })
})

describe('BulkActionBar — 一括採用', () => {
  it('既定は「Take が 1 件だけ」。確認は挟まない', async () => {
    const { props, user } = setup()

    await pick(user, '一括採用…')
    await user.click(screen.getByRole('button', { name: '12 件を採用' }))

    expect(props.onSelectTakes).toHaveBeenCalledWith('only')
  })

  it('最新の Take を選べる', async () => {
    const { props, user } = setup()

    await pick(user, '一括採用…')
    await user.selectOptions(screen.getByLabelText('規則'), 'latest')
    await user.click(screen.getByRole('button', { name: '12 件を採用' }))

    expect(props.onSelectTakes).toHaveBeenCalledWith('latest')
  })

  it('採用済みが混ざっていれば上書きになると断る', async () => {
    const { user } = setup({ alreadySelectedCount: 4 })

    await pick(user, '一括採用…')

    expect(screen.getByText('4 件は採用済みで、上書きになります。')).toBeInTheDocument()
  })
})

describe('BulkActionBar — 一括で変えるのは触った項目だけ', () => {
  const openUpdate = async (
    overrides: Partial<BulkActionBarProps> = {},
  ): Promise<ReturnType<typeof setup>> => {
    const view = setup(overrides)
    await pick(view.user, '一括で変える…')
    return view
  }

  it('何も触っていなければ適用できない', async () => {
    await openUpdate()

    expect(screen.getByRole('button', { name: '12 件に適用' })).toBeDisabled()
  })

  it('カメラだけ変えたら patch に camera しか入らない', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('カメラの景別'), 'wide')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    const patch = lastPatch(props.onUpdate)
    expect(Object.keys(patch)).toEqual(['camera'])
    expect(patch.camera).toEqual({ size: 'wide' })
  })

  /**
   * カメラの動きが未指定のままだと、動く Shot で被写体が画面から外れる（ADR-0042 の実測）。
   * 1 本ずつ開くと 39 回になるので、ここでまとめて入れられること。
   */
  it('カメラの動きと強さをまとめて入れられる', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('カメラの動き'), 'tilt')
    await user.selectOptions(screen.getByLabelText('動きの強さ'), 'moderate')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    const patch = lastPatch(props.onUpdate)
    expect(Object.keys(patch)).toEqual(['camera'])
    expect(patch.camera).toEqual({ movement: 'tilt', movementIntensity: 'moderate' })
  })

  /** 景別と動きを同時に触っても、**片方がもう片方を消さない**（`camera` は 1 つにまとめる）。 */
  it('景別と動きを同時に変えたら、両方が 1 つの camera に入る', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('カメラの景別'), 'wide')
    await user.selectOptions(screen.getByLabelText('カメラの動き'), 'pull_out')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    expect(lastPatch(props.onUpdate).camera).toEqual({ size: 'wide', movement: 'pull_out' })
  })

  /** 「未指定にする」は `null` で送る（省略＝変えない と別の意味）。 */
  it('カメラの動きを未指定に戻せる', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('カメラの動き'), '')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    expect(lastPatch(props.onUpdate).camera).toEqual({ movement: null })
  })

  it('mood を空にしたら mood だけが null で入る。他は入らない', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('雰囲気'), 'clear')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    const patch = lastPatch(props.onUpdate)
    expect(Object.keys(patch)).toEqual(['mood'])
    expect(patch.mood).toBeNull()
  })

  it('mood に値を入れたら trim して入る', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('雰囲気'), 'set')
    await user.type(screen.getByLabelText('雰囲気の値'), '  緊迫  ')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    expect(lastPatch(props.onUpdate)).toEqual({ mood: '緊迫' })
  })

  it('ロケーションを外すと locationId だけが null で入る', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('ロケーション'), '__clear__')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    const patch = lastPatch(props.onUpdate)
    expect(Object.keys(patch)).toEqual(['locationId'])
    expect(patch.locationId).toBeNull()
  })

  it('ロケーションを選ぶと id が入る。渡された「なし」は選択肢に出さない', async () => {
    const { props, user } = await openUpdate()

    expect(screen.queryByRole('option', { name: 'なし' })).toBeNull()

    await user.selectOptions(screen.getByLabelText('ロケーション'), 'loc-1')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    expect(lastPatch(props.onUpdate)).toEqual({ locationId: 'loc-1' })
  })

  it('3 つとも触れば 3 つとも入る', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('カメラの景別'), 'closeup')
    await user.selectOptions(screen.getByLabelText('雰囲気'), 'set')
    await user.type(screen.getByLabelText('雰囲気の値'), '静寂')
    await user.selectOptions(screen.getByLabelText('ロケーション'), 'loc-1')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    expect(lastPatch(props.onUpdate)).toEqual({
      camera: { size: 'closeup' },
      mood: '静寂',
      locationId: 'loc-1',
    })
  })

  it('説明はここには出さない。行の中で直す', async () => {
    await openUpdate()

    expect(screen.queryByLabelText('説明')).toBeNull()
  })
})

describe('BulkActionBar — mood の空欄は送らせない', () => {
  it('「この値にする」のまま空欄なら適用できず、理由が出る', async () => {
    const { props, user } = setup()

    await pick(user, '一括で変える…')
    await user.selectOptions(screen.getByLabelText('雰囲気'), 'set')

    expect(screen.getByRole('button', { name: '12 件に適用' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('雰囲気を入力してください')
    expect(props.onUpdate).not.toHaveBeenCalled()
  })
})

describe('BulkActionBar — 結果', () => {
  it('全部成功なら status で出す', () => {
    setup({ outcome: { summary: '12 件すべて成功しました。', failures: [] } })

    expect(screen.getByRole('status')).toHaveTextContent('12 件すべて成功しました。')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('失敗があれば alert で、1 件ずつ理由を出す', () => {
    setup({
      outcome: {
        summary: '12 件中 10 件成功。失敗 2 件。',
        failures: ['CUT-05: Take が無い', 'CUT-09: Take が複数ある'],
      },
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('12 件中 10 件成功。失敗 2 件。')
    expect(alert).toHaveTextContent('CUT-05: Take が無い')
    expect(alert).toHaveTextContent('CUT-09: Take が複数ある')
  })

  it('実行中は前回の結果を出さない。終わったと読み違える', () => {
    setup({ busy: true, outcome: { summary: '前回の結果', failures: [] } })

    expect(screen.queryByText('前回の結果')).toBeNull()
  })
})

/**
 * **最終状態の焦点を見ない**（lessons L-022）。
 * jsdom は要素の出入りで焦点を勝手に動かすため、戻したかどうかが読めない。
 * 開いたボタンの `focus()` が呼ばれたことを直接見る。
 */
describe('BulkActionBar — Escape で閉じて、開いたボタンへ戻る', () => {
  const openWithSpy = async (
    name: string,
  ): Promise<{
    readonly focusSpy: ReturnType<typeof vi.spyOn>
    readonly user: ReturnType<typeof userEvent.setup>
  }> => {
    const { user } = setup()
    const toggle = screen.getByRole('button', { name })
    const focusSpy = vi.spyOn(toggle, 'focus')
    await user.click(toggle)
    // 押したこと自体で 1 回呼ばれている。ここから先だけを数える。
    focusSpy.mockClear()
    return { focusSpy, user }
  }

  it('Escape で展開が閉じ、開いたボタンへ焦点が戻る（その他から開いたものは「その他」へ）', async () => {
    const { user } = setup()
    const more = screen.getByRole('button', { name: 'その他' })
    const focusSpy = vi.spyOn(more, 'focus')
    await pick(user, '一括採用…')
    focusSpy.mockClear()
    expect(screen.getByRole('group', { name: '一括採用' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('group', { name: '一括採用' })).toBeNull()
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('欄の中にいても Escape で閉じ、焦点が戻る', async () => {
    const { focusSpy, user } = await openWithSpy('Take を作る')

    await user.tab()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('group', { name: 'Take を作る' })).toBeNull()
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('もう一度押して閉じたときも焦点は残る', async () => {
    const { focusSpy, user } = await openWithSpy('Take を作る')

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.queryByRole('group', { name: 'Take を作る' })).toBeNull()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('開いていないときの Escape では焦点を動かさない', async () => {
    setup()
    const toggle = screen.getByRole('button', { name: 'Take を作る' })
    const focusSpy = vi.spyOn(toggle, 'focus')

    await userEvent.setup().keyboard('{Escape}')

    expect(focusSpy).not.toHaveBeenCalled()
  })
})

describe('BulkActionBar — 打鍵を外へ漏らさない', () => {
  it('バーの中の打鍵は親へ届かない。一覧には選択の割り当てがある', async () => {
    const onOuterKeyDown = vi.fn()
    render(
      <div onKeyDown={onOuterKeyDown}>
        <BulkActionBar
          selectedCount={3}
          alreadySelectedCount={0}
          lockedCount={0}
          unguidedCount={0}
          missingCameraCount={0}
          drawWarning={null}
          progress={null}
          modelOptions={MODEL_OPTIONS}
          cameraSizeOptions={CAMERA_SIZE_OPTIONS}
          locationOptions={LOCATION_OPTIONS}
          estimatedTotalUsd={null}
          busy={false}
          outcome={null}
          onGenerate={vi.fn()}
          onSelectTakes={vi.fn()}
          onUpdate={vi.fn()}
          onClearSelection={vi.fn()}
          onDelete={vi.fn()}
          onMerge={vi.fn()}
          onRender={vi.fn()}
          onDrawStartFrames={vi.fn()}
        />
      </div>,
    )
    const user = userEvent.setup()

    await pick(user, '一括で変える…')
    await user.selectOptions(screen.getByLabelText('雰囲気'), 'set')
    await user.type(screen.getByLabelText('雰囲気の値'), 'a')
    await user.keyboard('{Escape}')

    expect(onOuterKeyDown).not.toHaveBeenCalled()
  })
})

describe('BulkActionBar — 合計の見積（F3a）', () => {
  /**
   * **渡し忘れは型で止める。テストで止めない。**
   *
   * 以前は省略できる prop で既定が `null` だったため、唯一の呼び出し元
   * （`panels/shot-list-panel.tsx`）が渡しておらず「合計の見積」は一度も
   * 描画されなかった。省略できる形に戻ると `@ts-expect-error` が余計になり、
   * `tsc` がこの行で落ちる。
   */
  it('見積を渡し忘れたら型で落ちる', () => {
    const { estimatedTotalUsd, ...withoutEstimate } = baseProps({ estimatedTotalUsd: 1 })
    expect(estimatedTotalUsd).toBe(1)

    // @ts-expect-error estimatedTotalUsd は省略できない（省略できると F3a が再発する）
    const invalid: BulkActionBarProps = withoutEstimate
    expect(invalid.selectedCount).toBe(12)
  })

  /**
   * **確認ダイアログは「押す直前」。** 金額を出すならここに出す。
   * 出せないなら出せないと書く。空欄のまま押させない。
   */
  it('事前見積が取れないことを確認の文に書く', async () => {
    const { user } = setup({ estimatedTotalUsd: null })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))

    const asking = screen.getByRole('alertdialog')
    expect(asking).toHaveTextContent('いまは投入する前に出せません')
    expect(asking).toHaveTextContent('費用が掛かります')
  })

  it('見積が取れていれば確認の文に金額を出す', async () => {
    const { user } = setup({ estimatedTotalUsd: 12.5 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent('$12.50')
  })

  it('見積が取れていれば一括生成の中に出す', async () => {
    const { user } = setup({ estimatedTotalUsd: 12.5 })

    await user.click(screen.getByRole('button', { name: 'Take を作る' }))

    expect(screen.getByRole('group', { name: 'Take を作る' })).toHaveTextContent('$12.50')
  })
})

/**
 * 絵コンテの画像をまとめて作る（ADR-0029）。**既定は絵の無い Shot だけ**（作り直しは選んだときだけ）。
 * Codex は 1 枚 1 分ほどかかるので、かかる時間の目安を先に言う。
 */
describe('BulkActionBar — 絵コンテの画像', () => {
  it('開くと、枚数とかかる時間の目安を言う', async () => {
    const { user } = setup({ selectedCount: 12 })

    await user.click(screen.getByRole('button', { name: '絵を作る' }))

    expect(screen.getByText(/チェックした 12 件の絵コンテの画像/)).toBeTruthy()
    expect(screen.getByText(/1 枚 1 分ほど/)).toBeTruthy()
  })

  it('既定は絵の無い Shot だけを作る', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '絵を作る' }))
    await user.click(screen.getByRole('button', { name: '作る' }))

    expect(props.onDrawStartFrames).toHaveBeenCalledWith({ onlyMissing: true })
  })

  it('選べば、絵がある Shot も作り直す', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '絵を作る' }))
    await user.click(screen.getByRole('checkbox', { name: /絵がある Shot も作り直す/ }))
    await user.click(screen.getByRole('button', { name: '作る' }))

    expect(props.onDrawStartFrames).toHaveBeenCalledWith({ onlyMissing: false })
  })

  /** 絵コンテ（説明）が空の Shot が混じっていたら確かめる（制作者 2026-10-03「警告ダイアログを出して、任意の上で実行」）。 */
  it('絵コンテが空の Shot があれば確認を出し、「このまま作る」を押したときだけ作る', async () => {
    const { props, user } = setup({ drawWarning: 'チェックした 12 件のうち 3 件は絵コンテ（説明）がまだ空です。' })

    await user.click(screen.getByRole('button', { name: '絵を作る' }))
    await user.click(screen.getByRole('button', { name: '作る' }))
    expect(props.onDrawStartFrames).not.toHaveBeenCalled()
    expect(screen.getByText(/3 件は絵コンテ（説明）がまだ空/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'このまま作る' }))
    expect(props.onDrawStartFrames).toHaveBeenCalledWith({ onlyMissing: true })
  })
})
