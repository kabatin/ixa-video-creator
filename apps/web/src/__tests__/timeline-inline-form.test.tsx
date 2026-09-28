import {
  TextTemplateKey,
  TransitionType,
  isDegradedTransition,
  isPlaceholderTextTemplate,
} from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
/**
 * **判定の入り口は部品から読む。** 中身は `lib/timeline-inline-form.ts` にあるが、
 * 配線側はこの部品と同じ入り口から読んでいる。再輸出を消すとここが型検査で落ちる。
 */
import {
  TimelineInlineForm,
  inlineFormErrors,
  type InlineFormDraft,
  type InlineFormErrors,
} from '@/components/timeline-inline-form'

/**
 * 描画して確かめることだけを置く。**判定は `timeline-inline-form-logic.test.ts`。**
 *
 * その場に出る入力は、**キーボードだけで開いて打って送れること**が前提になっている
 * （制作者の指示）。マウスでしか閉じられない浮きものは、帯の上で邪魔になったときに
 * 逃げ場が無い。ここではその 2 点を実際に打って確かめる。
 *
 * もう 1 つの要は**打鍵を外へ漏らさないこと**。同じ画面には区切り・再生の
 * 割り当てがあり、文字を打っただけで区切りが置かれてはいけない（lessons L-018）。
 */

const TRANSITION_DRAFT: InlineFormDraft = {
  kind: 'transition',
  type: 'dissolve',
  durationSec: '0.50',
}

const TEXT_DRAFT: InlineFormDraft = {
  kind: 'text',
  templateKey: 'lower_third',
  text: '',
  startSec: '0',
  durationSec: '2',
}

type Handlers = {
  readonly onSubmit: ReturnType<typeof vi.fn>
  readonly onDismiss: ReturnType<typeof vi.fn>
  readonly onRemove: ReturnType<typeof vi.fn>
}

const setup = (
  draft: InlineFormDraft,
  options: {
    readonly errors?: InlineFormErrors
    readonly busy?: boolean
    readonly withRemove?: boolean
    readonly onEditLook?: () => void
  } = {},
): Handlers & {
  readonly user: ReturnType<typeof userEvent.setup>
  readonly unmount: () => void
} => {
  const onSubmit = vi.fn()
  const onDismiss = vi.fn()
  const onRemove = vi.fn()
  const view = render(
    <TimelineInlineForm
      draft={draft}
      anchor={{ leftPx: 100, topPx: 40 }}
      caption="0:03.75 の境目"
      errors={options.errors}
      busy={options.busy ?? false}
      onSubmit={onSubmit}
      onDismiss={onDismiss}
      onRemove={options.withRemove === true ? onRemove : undefined}
      {...(options.onEditLook === undefined ? {} : { onEditLook: options.onEditLook })}
    />,
  )
  return { onSubmit, onDismiss, onRemove, user: userEvent.setup(), unmount: view.unmount }
}

describe('TimelineInlineForm — キーボードだけで完結する', () => {
  it('開くと最初の欄へ焦点が移る（トランジション）', () => {
    setup(TRANSITION_DRAFT)

    expect(screen.getByLabelText('種類')).toHaveFocus()
  })

  it('開くと最初の欄へ焦点が移る（テロップ）', () => {
    setup(TEXT_DRAFT)

    expect(screen.getByLabelText('テンプレート')).toHaveFocus()
  })

  it('マウスを一度も使わずに、打って Enter で送れる（テロップ）', async () => {
    const { onSubmit, user } = setup(TEXT_DRAFT)

    // 焦点はテンプレート。そこから Tab で降りて打つ。
    await user.tab()
    await user.keyboard('サビ入り')
    await user.tab()
    await user.keyboard('{Control>}a{/Control}12.5')
    await user.tab()
    await user.keyboard('{Control>}a{/Control}3')
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'text',
      templateKey: 'lower_third',
      text: 'サビ入り',
      startSec: '12.5',
      durationSec: '3',
    })
  })

  it('最初の欄に焦点があるまま Enter でも送れる（トランジション）', async () => {
    const { onSubmit, user } = setup(TRANSITION_DRAFT)

    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledWith(TRANSITION_DRAFT)
  })

  it('Escape で閉じる。送りはしない', async () => {
    const { onDismiss, onSubmit, user } = setup(TEXT_DRAFT)

    await user.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('文字を打っている途中でも Escape で閉じられる', async () => {
    const { onDismiss, user } = setup(TEXT_DRAFT)

    await user.tab()
    await user.keyboard('テロップ')
    await user.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('やめるボタンでも閉じる', async () => {
    const { onDismiss, user } = setup(TEXT_DRAFT)

    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('TimelineInlineForm — 打鍵を外へ漏らさない', () => {
  const outside = vi.fn()
  afterEach(() => {
    document.removeEventListener('keydown', outside)
    outside.mockReset()
  })

  const listen = (): void => {
    document.addEventListener('keydown', outside)
  }

  it('入力欄で打った文字が外の割り当てへ届かない', async () => {
    const { user } = setup(TEXT_DRAFT)
    listen()

    await user.tab()
    await user.keyboard('sx ')

    expect(outside).not.toHaveBeenCalled()
  })

  it('送る Enter も閉じる Escape も外へは出ない', async () => {
    const { user } = setup(TRANSITION_DRAFT)
    listen()

    await user.keyboard('{Enter}')
    await user.keyboard('{Escape}')

    expect(outside).not.toHaveBeenCalled()
  })

  it('ボタンの上で打った Enter も外へ出ない', async () => {
    const { user } = setup(TRANSITION_DRAFT)
    listen()

    await user.click(screen.getByRole('button', { name: 'やめる' }))
    await user.keyboard('{Enter}')

    expect(outside).not.toHaveBeenCalled()
  })

  it('ボタンに焦点があるときの Enter では送らない（押した操作と二重に効かせない）', async () => {
    const { onSubmit, onDismiss, user } = setup(TRANSITION_DRAFT)

    screen.getByRole('button', { name: 'やめる' }).focus()
    await user.keyboard('{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
    // Enter はボタン自身の押下として効く。
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('TimelineInlineForm — 絵に出ない種別の注意は登録簿から作る', () => {
  it.each(TransitionType.options)('%s の注意は isDegradedTransition と一致する', (type) => {
    setup({ kind: 'transition', type, durationSec: '0.5' })

    const notice = screen.queryByRole('status')
    expect(notice === null).toBe(!isDegradedTransition(type))
  })

  it.each(TextTemplateKey.options)('%s の注意は登録簿と一致する', (templateKey) => {
    setup({ ...TEXT_DRAFT, kind: 'text', templateKey })

    const notice = screen.queryByRole('status')
    expect(notice === null).toBe(!isPlaceholderTextTemplate(templateKey))
  })

  it('選び直すと注意が出る', async () => {
    const { user } = setup(TRANSITION_DRAFT)
    const degraded = TransitionType.options.find(isDegradedTransition)
    if (degraded === undefined) return

    expect(screen.queryByRole('status')).toBeNull()
    await user.selectOptions(screen.getByLabelText('種類'), degraded)

    expect(screen.getByRole('status')).toHaveTextContent('絵に出ません')
  })
})

describe('TimelineInlineForm — 受け取った errors を出す', () => {
  it('欄のエラーは欄の直下に role=alert で出る', () => {
    setup(TEXT_DRAFT, { errors: { fields: { text: 'テロップの文字を入れてください' } } })

    const field = screen.getByLabelText('文字')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('テロップの文字を入れてください')
  })

  it('欄に属さないエラーも role=alert で出る', () => {
    setup(TRANSITION_DRAFT, { errors: { form: '前後の Shot が短すぎて置けません' } })

    expect(screen.getByRole('alert')).toHaveTextContent('前後の Shot が短すぎて置けません')
  })

  it('errors が無ければ何も出さない', () => {
    setup(TRANSITION_DRAFT)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('送信中は送れない', async () => {
    const { onSubmit, user } = setup(TRANSITION_DRAFT, { busy: true })

    await user.keyboard('{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('TimelineInlineForm — 既にあるものを開いたとき', () => {
  it('新しく置くときは削除を出さない', () => {
    setup(TRANSITION_DRAFT)

    expect(screen.queryByRole('button', { name: /削除/ })).toBeNull()
    expect(screen.getByRole('button', { name: '置く' })).toBeInTheDocument()
  })

  it('開いたものは消せる。置き直しになる', async () => {
    const { onRemove, user } = setup(TRANSITION_DRAFT, { withRemove: true })

    expect(screen.getByRole('button', { name: '置き直す' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '削除（トランジション）' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})

/** テロップの見た目はインスペクターで直す（ADR-0028）。小窓は狭いので入口だけ置く。 */
describe('TimelineInlineForm — 見た目を編集', () => {
  it('渡されたときだけ出し、押すと呼ぶ', async () => {
    const onEditLook = vi.fn()
    const { user } = setup(TEXT_DRAFT, { withRemove: true, onEditLook })

    await user.click(screen.getByRole('button', { name: '見た目を編集' }))

    expect(onEditLook).toHaveBeenCalledTimes(1)
  })

  it('渡されなければ出さない', () => {
    setup(TEXT_DRAFT)
    expect(screen.queryByRole('button', { name: '見た目を編集' })).toBeNull()
  })
})

describe('TimelineInlineForm — 選べる種別は挿入側が決める', () => {
  it('省略すると登録簿の全種を出す', () => {
    setup(TRANSITION_DRAFT)

    const options = screen.getByLabelText<HTMLSelectElement>('種類').options
    expect([...options].map((option) => option.value)).toEqual([...TransitionType.options])
  })

  it('絞って渡せば、外した種別は選べない', () => {
    const insertable = TransitionType.options.filter((type) => type !== 'cut')
    render(
      <TimelineInlineForm
        draft={TRANSITION_DRAFT}
        anchor={{ leftPx: 0, topPx: 0 }}
        transitionTypes={insertable}
        onSubmit={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    const options = screen.getByLabelText<HTMLSelectElement>('種類').options
    expect([...options].map((option) => option.value)).toEqual([...insertable])
  })
})

describe('TimelineInlineForm — 畳んだ errors を出す', () => {
  it('畳んだ結果をそのまま渡すと、両方が画面に出る', () => {
    setup(TEXT_DRAFT, {
      errors: inlineFormErrors([
        { field: 'text', message: 'テロップの文字を入れてください' },
        { field: 'layer', message: '同じ段に重なります' },
      ]),
    })

    const alerts = screen.getAllByRole('alert').map((node) => node.textContent)
    expect(alerts).toContain('テロップの文字を入れてください')
    expect(alerts).toContain('同じ段に重なります')
  })
})

/**
 * 本番の DB には、いまの登録簿に当てはまらないテロップが残っている。
 * 例: `{ templateKey: 'lower-third', params: { label: 'iXA CUP' } }`。
 * **開いて壊れないだけでは足りない。** 読めなかったことを伝えないまま送らせると、
 * 元の内容を黙って踏み潰す。
 */
describe('TimelineInlineForm — 読めない値で開いたとき', () => {
  const UNREADABLE: InlineFormDraft = {
    kind: 'text',
    templateKey: null,
    rawTemplateKey: 'lower-third',
    text: null,
    startSec: '1',
    durationSec: '2',
  }

  it('見せ方と文字で別の言い方をする', () => {
    setup(UNREADABLE)

    const messages = screen.getAllByRole('alert').map((node) => node.textContent ?? '')
    expect(messages).toHaveLength(2)
    expect(new Set(messages).size).toBe(2)
    // 保存されている値を見せる。何を踏み潰すのか分からないと判断できない。
    expect(messages.some((m) => m.includes('lower-third'))).toBe(true)
    expect(messages.every((m) => m.includes('上書き'))).toBe(true)
  })

  it('空欄が元の文字だと誤解させない', () => {
    setup(UNREADABLE)

    const textAlert = screen
      .getAllByRole('alert')
      .map((node) => node.textContent ?? '')
      .find((m) => !m.includes('lower-third'))
    expect(textAlert).toContain('空欄は元の文字ではありません')
  })

  it('読めない見せ方は選ばれていない状態で開く', () => {
    setup(UNREADABLE)

    const select = screen.getByLabelText<HTMLSelectElement>('テンプレート')
    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.value)).toContain('')
  })

  it('打ち始めても断りは消えない', async () => {
    const { user } = setup(UNREADABLE)

    await user.tab()
    await user.keyboard('新しい文字')

    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('読めなかったことは null のまま上へ返す。空文字に畳まない', async () => {
    const { onSubmit, user } = setup(UNREADABLE)

    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'text',
      templateKey: null,
      rawTemplateKey: 'lower-third',
      text: null,
      startSec: '1',
      durationSec: '2',
    })
  })

  it('選び直すと、その値が上へ返る', async () => {
    const { onSubmit, user } = setup(UNREADABLE)

    await user.selectOptions(screen.getByLabelText('テンプレート'), 'plain')
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'plain' }))
  })

  it('読める値で開いたときは断りを出さない', () => {
    setup({ ...TEXT_DRAFT, kind: 'text', text: 'いま入っている文字' })

    expect(screen.queryByRole('alert')).toBeNull()
  })
})

/**
 * **`document.activeElement` を見て確かめない。** jsdom は木を外したあとに焦点を
 * 戻してしまい、焦点を奪ったかどうかが最終状態からは読めない（実際に、
 * 見張りを外しても最終状態は同じになり、テストが素通りした）。
 * 戻しに行ったかどうかを `focus()` の呼び出しで直接見る。
 */
describe('TimelineInlineForm — 閉じたら開く元へ焦点を戻す', () => {
  const setupWithOpener = (): {
    readonly opener: HTMLButtonElement
    readonly focusSpy: ReturnType<typeof vi.spyOn>
    readonly unmount: () => void
    readonly user: ReturnType<typeof userEvent.setup>
  } => {
    const opener = document.createElement('button')
    opener.textContent = '挿入'
    document.body.append(opener)
    const focusSpy = vi.spyOn(opener, 'focus')
    const ref = { current: opener }
    const view = render(
      <TimelineInlineForm
        draft={TRANSITION_DRAFT}
        anchor={{ leftPx: 0, topPx: 0 }}
        returnFocusRef={ref}
        onSubmit={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    return { opener, focusSpy, unmount: view.unmount, user: userEvent.setup() }
  }

  afterEach(() => {
    document.querySelectorAll('body > button').forEach((node) => {
      node.remove()
    })
  })

  it('開いた直後は挿入ボタンではなく最初の欄に焦点がある', () => {
    const { opener, focusSpy } = setupWithOpener()

    expect(opener).not.toHaveFocus()
    expect(screen.getByLabelText('種類')).toHaveFocus()
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('閉じると挿入ボタンへ戻る。先頭へ飛ばされない', () => {
    const { opener, focusSpy, unmount } = setupWithOpener()

    unmount()

    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
  })

  it('外を触って閉じたときは焦点を奪わない', async () => {
    const { focusSpy, unmount, user } = setupWithOpener()
    const elsewhere = document.createElement('button')
    elsewhere.textContent = '別の場所'
    document.body.append(elsewhere)

    await user.click(elsewhere)
    unmount()

    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('returnFocusRef を渡さなければ何もしない', () => {
    const { unmount } = setup(TRANSITION_DRAFT)

    expect(() => {
      unmount()
    }).not.toThrow()
  })
})
