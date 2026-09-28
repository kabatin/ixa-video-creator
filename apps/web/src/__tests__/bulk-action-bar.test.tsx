import { ModelId } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
  onDrawStartFrames: vi.fn(),
  ...overrides,
})

const setup = (
  overrides: Partial<BulkActionBarProps> = {},
): {
  readonly props: BulkActionBarProps
  readonly user: ReturnType<typeof userEvent.setup>
} => {
  const props = baseProps(overrides)
  render(<BulkActionBar {...props} />)
  return { props, user: userEvent.setup() }
}

/** 最後に `onUpdate` へ渡された patch。**キーの有無まで見たいので型を落とさない。** */
const lastPatch = (onUpdate: BulkActionBarProps['onUpdate']): BulkUpdatePatch => {
  const spy = vi.mocked(onUpdate)
  const call = spy.mock.calls.at(-1)
  if (call === undefined) throw new Error('onUpdate が呼ばれていない')
  return call[0]
}

describe('BulkActionBar — 出る / 出ない', () => {
  it('選択が 0 件のときは何も描かない', () => {
    setup({ selectedCount: 0 })

    expect(screen.queryByRole('region', { name: '一括操作' })).toBeNull()
  })

  it('選ばれていれば件数と 3 つの操作が出る', () => {
    setup({ selectedCount: 12 })

    expect(screen.getByText('12 件を選択中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括採用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括で変える' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '選択を解除' })).toBeInTheDocument()
  })

  it('開くのは 1 つだけ。別を開くと前が閉じる', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: '一括生成' }))
    expect(screen.getByRole('group', { name: '一括生成' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '一括で変える' }))

    expect(screen.queryByRole('group', { name: '一括生成' })).toBeNull()
    expect(screen.getByRole('group', { name: '一括で変える' })).toBeInTheDocument()
  })

  /**
   * 実行中は**進捗ダイアログが手を止める**。
   * 以前はバーの中に 1 行出すだけで、密なパネルの下のほうだと気づけなかった。
   */
  it('実行中は進捗ダイアログが出て、バー全体が止まる', () => {
    setup({ busy: true })

    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.getByRole('status')).toHaveTextContent('依頼を送っています')
    expect(screen.getByRole('button', { name: '一括生成' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '選択を解除' })).toBeDisabled()
  })

  it('投入したあとも、終わった件数を数えて見せる', () => {
    setup({ busy: false, progress: { done: 3, total: 8 } })

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '38')
    expect(screen.getByRole('status')).toHaveTextContent('3 / 8 件 終わりました')
  })

  it('走っていなければ進捗ダイアログは出ない', () => {
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

    await user.click(screen.getByRole('button', { name: /削除/ }))

    expect(props.onDelete).toHaveBeenCalledTimes(1)
  })

  /** 隣り合う Shot を先頭にまとめる（ADR-0024）。確認は開いた先が取る。 */
  it('結合はそのまま呼ぶ（すぐにはまとめない）', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '結合…' }))

    expect(props.onMerge).toHaveBeenCalledTimes(1)
  })
})

describe('BulkActionBar — 一括生成は 2 段階', () => {
  it('1 回押しただけでは依頼しない。確認してから呼ぶ', async () => {
    const { props, user } = setup({ selectedCount: 12 })

    await user.click(screen.getByRole('button', { name: '一括生成' }))
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))

    expect(props.onGenerate).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('取り消せません')

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

    await user.click(screen.getByRole('button', { name: '一括生成' }))
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))
    await user.click(screen.getByRole('button', { name: '依頼する' }))

    expect(screen.queryByRole('button', { name: '12 件に生成を依頼' })).toBeNull()
    expect(screen.getByRole('button', { name: '一括生成' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('選んだモデルと本数がそのまま渡る', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '一括生成' }))
    await user.selectOptions(screen.getByLabelText('モデル'), 'veo-3')
    await user.selectOptions(screen.getByLabelText('本数'), '3')
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))
    await user.click(screen.getByRole('button', { name: '依頼する' }))

    expect(props.onGenerate).toHaveBeenCalledWith({ model: 'veo-3', count: 3 })
  })

  it('ロックされた件は数に入れず、理由を出す', async () => {
    const { user } = setup({ selectedCount: 10, lockedCount: 3 })

    await user.click(screen.getByRole('button', { name: '一括生成' }))

    expect(screen.getByRole('button', { name: '7 件に生成を依頼' })).toBeEnabled()
    expect(screen.getByText('3 件はロックされているため、生成されません。')).toBeInTheDocument()
  })

  it('全件ロックなら依頼できない', async () => {
    const { user } = setup({ selectedCount: 3, lockedCount: 3 })

    await user.click(screen.getByRole('button', { name: '一括生成' }))

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

    await user.click(screen.getByRole('button', { name: '一括生成' }))

    expect(screen.getByText(/合計の見積: いまは投入する前に出せません/)).toBeInTheDocument()
  })

  it('見積 0 は「未取得」と混ぜず、0 として出す', async () => {
    const { user } = setup({ estimatedTotalUsd: 0 })

    await user.click(screen.getByRole('button', { name: '一括生成' }))

    expect(screen.getByText('合計の見積: $0.00')).toBeInTheDocument()
  })
})

describe('BulkActionBar — 一括採用', () => {
  it('既定は「Take が 1 件だけ」。確認は挟まない', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '一括採用' }))
    await user.click(screen.getByRole('button', { name: '12 件を採用' }))

    expect(props.onSelectTakes).toHaveBeenCalledWith('only')
  })

  it('最新の Take を選べる', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '一括採用' }))
    await user.selectOptions(screen.getByLabelText('規則'), 'latest')
    await user.click(screen.getByRole('button', { name: '12 件を採用' }))

    expect(props.onSelectTakes).toHaveBeenCalledWith('latest')
  })

  it('採用済みが混ざっていれば上書きになると断る', async () => {
    const { user } = setup({ alreadySelectedCount: 4 })

    await user.click(screen.getByRole('button', { name: '一括採用' }))

    expect(screen.getByText('4 件は採用済みで、上書きになります。')).toBeInTheDocument()
  })
})

describe('BulkActionBar — 一括で変えるのは触った項目だけ', () => {
  const openUpdate = async (
    overrides: Partial<BulkActionBarProps> = {},
  ): Promise<ReturnType<typeof setup>> => {
    const view = setup(overrides)
    await view.user.click(screen.getByRole('button', { name: '一括で変える' }))
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

  it('mood を空にしたら mood だけが null で入る。他は入らない', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('mood'), 'clear')
    await user.click(screen.getByRole('button', { name: '12 件に適用' }))

    const patch = lastPatch(props.onUpdate)
    expect(Object.keys(patch)).toEqual(['mood'])
    expect(patch.mood).toBeNull()
  })

  it('mood に値を入れたら trim して入る', async () => {
    const { props, user } = await openUpdate()

    await user.selectOptions(screen.getByLabelText('mood'), 'set')
    await user.type(screen.getByLabelText('mood の値'), '  緊迫  ')
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
    await user.selectOptions(screen.getByLabelText('mood'), 'set')
    await user.type(screen.getByLabelText('mood の値'), '静寂')
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

    await user.click(screen.getByRole('button', { name: '一括で変える' }))
    await user.selectOptions(screen.getByLabelText('mood'), 'set')

    expect(screen.getByRole('button', { name: '12 件に適用' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('mood を入力してください')
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

  it('Escape で展開が閉じ、開いたボタンへ焦点が戻る', async () => {
    const { focusSpy, user } = await openWithSpy('一括採用')
    expect(screen.getByRole('group', { name: '一括採用' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('group', { name: '一括採用' })).toBeNull()
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('欄の中にいても Escape で閉じ、焦点が戻る', async () => {
    const { focusSpy, user } = await openWithSpy('一括で変える')

    await user.tab()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('group', { name: '一括で変える' })).toBeNull()
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('もう一度押して閉じたときも焦点は残る', async () => {
    const { focusSpy, user } = await openWithSpy('一括生成')

    await user.click(screen.getByRole('button', { name: '一括生成' }))

    expect(screen.queryByRole('group', { name: '一括生成' })).toBeNull()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('開いていないときの Escape では焦点を動かさない', async () => {
    setup()
    const toggle = screen.getByRole('button', { name: '一括生成' })
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
          onDrawStartFrames={vi.fn()}
        />
      </div>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '一括で変える' }))
    await user.selectOptions(screen.getByLabelText('mood'), 'set')
    await user.type(screen.getByLabelText('mood の値'), 'a')
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

    await user.click(screen.getByRole('button', { name: '一括生成' }))
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))

    const asking = screen.getByRole('alertdialog')
    expect(asking).toHaveTextContent('いまは投入する前に出せません')
    expect(asking).toHaveTextContent('取り消せません')
  })

  it('見積が取れていれば確認の文に金額を出す', async () => {
    const { user } = setup({ estimatedTotalUsd: 12.5 })

    await user.click(screen.getByRole('button', { name: '一括生成' }))
    await user.click(screen.getByRole('button', { name: '12 件に生成を依頼' }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent('$12.50')
  })

  it('見積が取れていれば一括生成の中に出す', async () => {
    const { user } = setup({ estimatedTotalUsd: 12.5 })

    await user.click(screen.getByRole('button', { name: '一括生成' }))

    expect(screen.getByRole('group', { name: '一括生成' })).toHaveTextContent('$12.50')
  })
})

/**
 * 絵コンテの画像をまとめて作る（ADR-0029）。**既定は絵の無い Shot だけ**（作り直しは選んだときだけ）。
 * Codex は 1 枚 1 分ほどかかるので、かかる時間の目安を先に言う。
 */
describe('BulkActionBar — 絵コンテの画像', () => {
  it('開くと、枚数とかかる時間の目安を言う', async () => {
    const { user } = setup({ selectedCount: 12 })

    await user.click(screen.getByRole('button', { name: '絵コンテの画像' }))

    expect(screen.getByText(/チェックした 12 件の絵コンテの画像/)).toBeTruthy()
    expect(screen.getByText(/1 枚 1 分ほど/)).toBeTruthy()
  })

  it('既定は絵の無い Shot だけを作る', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '絵コンテの画像' }))
    await user.click(screen.getByRole('button', { name: '作る' }))

    expect(props.onDrawStartFrames).toHaveBeenCalledWith({ onlyMissing: true })
  })

  it('選べば、絵がある Shot も作り直す', async () => {
    const { props, user } = setup()

    await user.click(screen.getByRole('button', { name: '絵コンテの画像' }))
    await user.click(screen.getByRole('checkbox', { name: /絵がある Shot も作り直す/ }))
    await user.click(screen.getByRole('button', { name: '作る' }))

    expect(props.onDrawStartFrames).toHaveBeenCalledWith({ onlyMissing: false })
  })
})
