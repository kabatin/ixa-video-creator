import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InlineTextCell,
  describeInlineTextKeys,
  resolveInlineTextKey,
} from '@/components/inline-text-cell'

/**
 * 一覧の行の中で直せる欄（P58-3）。
 *
 * ここで守りたいのは 3 つ。
 * 1. **`onSave` は 1 回の編集で最大 1 回**。Enter で保存 → その処理で blur → もう一度保存、
 *    という二重発火が典型（欄を止めると blur が飛んでくる）
 * 2. **打鍵を外へ漏らさない**。一覧には選択などの割り当てが乗る（lessons L-018）
 * 3. **焦点を戻したことは `focus()` の呼び出しで見る**。
 *    jsdom の `activeElement` の最終状態では確かめられない（lessons L-022）
 */

type Deferred = {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (reason: unknown) => void
}

const deferred = (): Deferred => {
  let resolve: () => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = () => {
      res()
    }
    reject = rej
  })
  return { promise, resolve, reject }
}

const setup = (
  options: {
    readonly value?: string
    readonly multiline?: boolean
    readonly disabled?: boolean
    readonly onSave?: (next: string) => Promise<void>
  } = {},
) => {
  const onSave = options.onSave ?? vi.fn().mockResolvedValue(undefined)
  const onParentKeyDown = vi.fn()
  render(
    <div onKeyDown={onParentKeyDown}>
      <InlineTextCell
        value={options.value ?? '夜の街を歩く'}
        multiline={options.multiline ?? false}
        placeholder="説明を追加"
        label="CUT-01 の説明"
        disabled={options.disabled ?? false}
        onSave={onSave}
      />
    </div>,
  )
  return { onSave, onParentKeyDown, user: userEvent.setup() }
}

const openCell = async (user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button'))
  return screen.getByRole('textbox', { name: 'CUT-01 の説明' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveInlineTextKey', () => {
  const base = { metaKey: false, ctrlKey: false, shiftKey: false }

  it('1 行のときは素の Enter で保存する', () => {
    expect(resolveInlineTextKey({ ...base, key: 'Enter' }, false)).toBe('save')
  })

  it('複数行のときの素の Enter は改行にする', () => {
    expect(resolveInlineTextKey({ ...base, key: 'Enter' }, true)).toBe('contain')
  })

  it('複数行でも Cmd/Ctrl + Enter なら保存する', () => {
    expect(resolveInlineTextKey({ ...base, key: 'Enter', metaKey: true }, true)).toBe('save')
    expect(resolveInlineTextKey({ ...base, key: 'Enter', ctrlKey: true }, true)).toBe('save')
  })

  it('Shift + Enter は保存に使わない', () => {
    expect(resolveInlineTextKey({ ...base, key: 'Enter', shiftKey: true }, false)).toBe('contain')
  })

  it('Escape は取り消し、それ以外の文字は欄の中で処理する', () => {
    expect(resolveInlineTextKey({ ...base, key: 'Escape' }, false)).toBe('cancel')
    expect(resolveInlineTextKey({ ...base, key: ' ' }, false)).toBe('contain')
    expect(resolveInlineTextKey({ ...base, key: 'a' }, true)).toBe('contain')
  })
})

describe('describeInlineTextKeys', () => {
  // 説明は判定を通して作る。手で書くと割り当てが変わっても古いまま残る（lessons L-018）。
  it('複数行では Enter を保存として案内しない', () => {
    expect(describeInlineTextKeys(true)).toEqual([
      { keys: '⌘/Ctrl + Enter', action: '保存' },
      { keys: 'Escape', action: '取り消し' },
    ])
  })

  it('1 行では Enter を保存として案内する', () => {
    expect(describeInlineTextKeys(false)).toEqual([
      { keys: 'Enter', action: '保存' },
      { keys: 'Escape', action: '取り消し' },
    ])
  })
})

describe('InlineTextCell / 読む姿', () => {
  it('空のときは「—」ではなく押せると分かる文を出す', () => {
    setup({ value: '' })
    expect(screen.getByRole('button', { name: 'CUT-01 の説明: 説明を追加' })).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('Enter でも直す姿を開ける（button なのでキーボードで押せる）', async () => {
    const { user } = setup()
    screen.getByRole('button').focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'CUT-01 の説明' })).toBeInTheDocument()
  })

  it('disabled のときは開かない', async () => {
    const { user } = setup({ disabled: true })
    await user.click(screen.getByRole('button'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('InlineTextCell / 直す姿', () => {
  it('開いた瞬間に焦点を移し、元の値を全選択する', async () => {
    const { user } = setup()
    const control = await openCell(user)
    expect(control).toHaveFocus()
    expect((control as HTMLInputElement).selectionStart).toBe(0)
    expect((control as HTMLInputElement).selectionEnd).toBe('夜の街を歩く'.length)
  })

  it('Enter で保存し、保存中に blur が来ても onSave は 1 回だけ', async () => {
    const pending = deferred()
    const onSave = vi.fn().mockReturnValue(pending.promise)
    const { user } = setup({ onSave })
    const control = await openCell(user)

    await user.clear(control)
    await user.type(control, '朝の駅を歩く')
    await user.keyboard('{Enter}')

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('朝の駅を歩く')
    // 保存中は欄を止め、状況を出す。
    expect(control).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('保存中')

    // 欄を止めたことで飛んでくる blur。ここで 2 回目を出してはいけない。
    fireEvent.focusOut(control)
    expect(onSave).toHaveBeenCalledTimes(1)

    pending.resolve()
    expect(await screen.findByRole('button')).toBeInTheDocument()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('欄を離れたら保存する', async () => {
    const { user, onSave } = setup()
    const control = await openCell(user)
    await user.clear(control)
    await user.type(control, '朝の駅を歩く')

    fireEvent.focusOut(control)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('朝の駅を歩く')
  })

  it('値が変わっていなければ onSave を呼ばない', async () => {
    const { user, onSave } = setup()
    const control = await openCell(user)

    fireEvent.focusOut(control)

    expect(onSave).not.toHaveBeenCalled()
    expect(await screen.findByRole('button')).toBeInTheDocument()
  })

  it('Escape で元に戻し、その直後の blur でも保存しない', async () => {
    const { user, onSave } = setup()
    const control = await openCell(user)
    await user.clear(control)
    await user.type(control, '捨てる文字')

    await user.keyboard('{Escape}')
    fireEvent.focusOut(control)

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'CUT-01 の説明: 夜の街を歩く' })).toBeInTheDocument()
  })

  it('複数行のときは Enter で改行し、Cmd+Enter で保存する', async () => {
    const { user, onSave } = setup({ multiline: true, value: '' })
    await user.click(screen.getByRole('button'))
    const control = screen.getByRole('textbox', { name: 'CUT-01 の説明' })

    await user.type(control, '一行目{Enter}二行目')
    expect(onSave).not.toHaveBeenCalled()
    expect(control).toHaveValue('一行目\n二行目')

    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('一行目\n二行目')
  })

  it('失敗したら打った内容が残り、理由が出る', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('サーバが応答しません'))
    const { user } = setup({ onSave })
    const control = await openCell(user)
    await user.clear(control)
    await user.type(control, '朝の駅を歩く')

    await user.keyboard('{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('サーバが応答しません')
    // 直す姿のまま。打った内容を捨てない。
    expect(screen.getByRole('textbox', { name: 'CUT-01 の説明' })).toHaveValue('朝の駅を歩く')
    expect(screen.queryByRole('button', { name: /CUT-01 の説明:/ })).not.toBeInTheDocument()
  })

  it('理由を読み取れなくても「保存できなかった」ことは出す', async () => {
    const onSave = vi.fn().mockRejectedValue('文字列で投げられた')
    const { user } = setup({ onSave })
    const control = await openCell(user)
    await user.clear(control)
    await user.type(control, '朝の駅を歩く')

    await user.keyboard('{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした。')
  })

  it('失敗したあと、もう一度保存できる', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('サーバが応答しません'))
      .mockResolvedValueOnce(undefined)
    const { user } = setup({ onSave })
    const control = await openCell(user)
    await user.clear(control)
    await user.type(control, '朝の駅を歩く')
    await user.keyboard('{Enter}')
    await screen.findByRole('alert')

    await user.keyboard('{Enter}')

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('button')).toBeInTheDocument()
  })
})

describe('InlineTextCell / 焦点と打鍵', () => {
  // **`focus()` の呼び出しそのものを見る。** 最終状態の activeElement では
  // 「戻したのか、環境が戻したのか」が区別できない（lessons L-022）。
  it('保存したら焦点を読む姿のボタンへ戻す', async () => {
    const { user } = setup()
    const control = await openCell(user)
    await user.clear(control)
    await user.type(control, '朝の駅を歩く')

    const focusSpy = vi.spyOn(HTMLButtonElement.prototype, 'focus')
    await user.keyboard('{Enter}')
    await screen.findByRole('button')

    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('保存に失敗したときは焦点を動かさない', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('サーバが応答しません'))
    const { user } = setup({ onSave })
    const control = await openCell(user)
    await user.clear(control)
    await user.type(control, '朝の駅を歩く')

    const focusSpy = vi.spyOn(HTMLButtonElement.prototype, 'focus')
    await user.keyboard('{Enter}')
    await screen.findByRole('alert')

    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('欄の中の Enter / Escape / Space が親の keydown に届かない', async () => {
    const { user, onParentKeyDown } = setup()
    const control = await openCell(user)

    await user.type(control, ' ')
    expect(onParentKeyDown).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onParentKeyDown).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button'))
    await user.keyboard('{Enter}')
    expect(onParentKeyDown).not.toHaveBeenCalled()
  })

  it('読む姿のボタンの打鍵も親へ流さない', async () => {
    const { user, onParentKeyDown } = setup()
    screen.getByRole('button').focus()
    await user.keyboard('{ArrowDown}')
    expect(onParentKeyDown).not.toHaveBeenCalled()
  })
})
