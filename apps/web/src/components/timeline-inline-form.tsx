'use client'

import {
  MAX_TEXT_CLIP_LENGTH,
  TextTemplateKey as TextTemplateKeySchema,
  TransitionType as TransitionTypeSchema,
  isDegradedTransition,
  isPlaceholderTextTemplate,
  type TextTemplateKey,
  type TransitionType,
} from '@ixa/domain'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FIELD_HINT_CLASS } from '@/components/form/field-styles'
import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { Button } from '@/components/ui/button'
import { transitionTypeLabel } from '@/lib/timeline-display'
import {
  clampInlinePanelPosition,
  resolveInlineFormKey,
  type InlineFieldName,
  type InlineFormAnchor,
  type InlineFormDraft,
  type InlineFormErrors,
  type InlinePanelPlacement,
} from '@/lib/timeline-inline-form'
import { WORDING } from '@/lib/wording'

/**
 * 帯の上のその場に浮く、小さな入力（P57-4）。狭い場所に浮くことを前提にする。
 *
 * **判定はここに書かない。** 秒の読み取り・重なり・隙間の検証は
 * `lib/timeline-insert.ts` が持つ。この部品は打たれた値をそのまま上へ返し、
 * 返ってきた `errors` を出すだけにする（lessons L-016）。
 * **絵に出ない種別の注意も登録簿から作る。** 書き写さず毎回訊く。
 *
 * 判定の中身は `lib/timeline-inline-form.ts` にある。**ここは表示だけ。**
 * 下の再輸出を消さないこと。配線側はこの部品と同じ入り口から
 * `inlineFormErrors` や `InlineFormAnchor` を読んでいる。
 */

export {
  INLINE_PANEL_MARGIN_PX,
  clampInlinePanelPosition,
  describeInlineFormKeys,
  inlineFormErrors,
  resolveInlineFormKey,
} from '@/lib/timeline-inline-form'
export type {
  InlineFieldName,
  InlineFormAnchor,
  InlineFormDraft,
  InlineFormErrors,
  InlineFormIssue,
  InlineFormKeyAction,
  InlineFormKeyEvent,
  InlineFormKeyHelp,
  InlinePanelBox,
  InlinePanelPlacement,
  InlineTextDraft,
  InlineTransitionDraft,
} from '@/lib/timeline-inline-form'

// --- 選択肢と注意 ---
/** 表示名。**ズレても壊れないものだけ複製する**（lessons L-016）。増えたら型検査で落ちる。 */
const TEXT_TEMPLATE_LABELS: Readonly<Record<TextTemplateKey, string>> = {
  plain: 'そのまま（中央）',
  lower_third: '下帯（字幕）',
}

/** 選んだものが絵に出ないなら注意文。出るなら null。**登録簿に毎回訊く。** */
const degradedNotice = (draft: InlineFormDraft): string | null => {
  if (draft.kind === 'transition') {
    return isDegradedTransition(draft.type)
      ? `${transitionTypeLabel(draft.type)}はまだ絵に出ません。書き出すとカットになります。`
      : null
  }
  if (draft.templateKey === null) return null
  return isPlaceholderTextTemplate(draft.templateKey)
    ? `${TEXT_TEMPLATE_LABELS[draft.templateKey]}はまだ絵に出ません。枠だけが出ます。`
    : null
}

/**
 * 読めなかったときの断り。**見せ方と文字で別の言い方にする。** 「どちらかが
 * 読めない」では、どちらを直せばよいか分からない。どちらも結果まで書く。
 */
const UNREADABLE_TEMPLATE = (raw: string | undefined): string =>
  `保存されている見せ方${raw === undefined ? '' : `「${raw}」`}は、いまの登録簿にありません。` +
  '選び直して送ると、保存されている見せ方は上書きされます。'

const UNREADABLE_TEXT =
  '保存されている文字を読み取れませんでした。空欄は元の文字ではありません。' +
  'このまま送ると、保存されている文字は上書きされます。'

const TEXT_LENGTH_HINT = `${String(MAX_TEXT_CLIP_LENGTH)} 文字まで`

/** 読めなかったことの断り。欄の直下に出す。 */
const Unreadable = ({ children }: { readonly children: string }) => (
  <p role="alert" className="mt-1 text-xs text-danger">
    {children}
  </p>
)
const PANEL_TITLES: Readonly<Record<InlineFormDraft['kind'], string>> = {
  transition: 'トランジション',
  text: 'テロップ',
}

// --- 部品 ---
export type TimelineInlineFormProps = {
  /** 初期値。**開く場所が変わったら `key` も変えること。** 打ちかけが残る。 */
  readonly draft: InlineFormDraft
  /** 帯の上のどこに出すか。位置指定済みの親要素から見た px。 */
  readonly anchor: InlineFormAnchor
  /** どこを触っているかの説明（`0:03.75 の境目` など）。 */
  readonly caption?: string
  /**
   * 選べる種別。**省略すると登録簿の全種。** 「どれを挿せるか」は挿入側の判断
   * （`INSERTABLE_TRANSITION_TYPES` は `cut` を外す）なので、絞るなら必ず渡す。
   */
  readonly transitionTypes?: readonly TransitionType[]
  readonly templateKeys?: readonly TextTemplateKey[]
  /** 検証結果。**この部品は判定しない。** `inlineFormErrors()` で畳んで渡せる。 */
  readonly errors?: InlineFormErrors
  /** 送信中。欄とボタンを止める。 */
  readonly busy?: boolean
  readonly onSubmit: (draft: InlineFormDraft) => void
  /** Escape / やめる。**送信後に閉じるかどうかは呼び出し側の判断。** */
  readonly onDismiss: () => void
  /**
   * 既にあるものを開いたときだけ渡す。**確認は挟まない**（この入力で置き直せる）。
   * 置き直せないものだけに確認を挟む判断は `timeline-delete-confirm.test.tsx`。
   */
  readonly onRemove?: () => void
  /**
   * 開く元になったボタン。閉じるときに焦点をここへ戻す。**戻すのはこの部品の
   * 仕事にする**（呼び出し側は ref を渡して外すだけ）。閉じ方は Escape・やめる・
   * 送信後・外側の操作と何通りもあり、1 つ戻し忘れると現在地を失う。
   */
  readonly returnFocusRef?: { current: HTMLElement | null }
}

const samePlacement = (a: InlinePanelPlacement, b: InlinePanelPlacement): boolean =>
  a.leftPx === b.leftPx && a.topPx === b.topPx && a.placedAbove === b.placedAbove
export const TimelineInlineForm = ({
  draft,
  anchor,
  caption,
  transitionTypes = TransitionTypeSchema.options,
  templateKeys = TextTemplateKeySchema.options,
  errors,
  busy = false,
  onSubmit,
  onDismiss,
  onRemove,
  returnFocusRef,
}: TimelineInlineFormProps) => {
  const idPrefix = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  // 開いた直後は自分が焦点を持っている。外を触って閉じたときだけ false になる。
  const focusInside = useRef(true)
  const [values, setValues] = useState<InlineFormDraft>(draft)
  const initial = { leftPx: anchor.leftPx, topPx: anchor.topPx, placedAbove: false }
  const [placement, setPlacement] = useState<InlinePanelPlacement>(initial)

  const firstFieldId = `${idPrefix}-${values.kind === 'transition' ? 'type' : 'template'}`

  // 開いたら最初の欄へ。**開かれ方で分けない。** 挿入ボタンは Tab でも辿り着けるため、
  // マウスのときだけ移すと、キーボードの利用者が欄へ入れない。
  useLayoutEffect(() => {
    document.getElementById(firstFieldId)?.focus()
  }, [firstFieldId])

  // 閉じたら開く元へ焦点を戻す。**外を触って閉じたときは奪わない**（そこが現在地）。
  useLayoutEffect(() => {
    const opener = returnFocusRef
    return () => {
      if (focusInside.current) opener?.current?.focus()
    }
  }, [returnFocusRef])

  // 器からはみ出さない場所へ寄せる。**依存配列を置かない。** エラーや注意で
  // 高さが変わるため毎回測る。同じ値なら更新しないので繰り返しは起きない。
  useLayoutEffect(() => {
    const panel = panelRef.current
    const parent = panel?.offsetParent
    if (!panel || !(parent instanceof HTMLElement)) return
    // 測れない（描画されていない）ときは動かさない。0 へ寄せると左上へ飛ぶ。
    if (parent.clientWidth === 0 || panel.offsetWidth === 0) return
    const next = clampInlinePanelPosition(
      anchor,
      { widthPx: panel.offsetWidth, heightPx: panel.offsetHeight },
      { widthPx: parent.clientWidth, heightPx: parent.clientHeight },
    )
    setPlacement((current) => (samePlacement(current, next) ? current : next))
  })

  const fieldError = (field: InlineFieldName): string | undefined => errors?.fields?.[field]
  const notice = degradedNotice(values)
  // **開いたときの値**で判断する。打ち始めても断りは消さない。
  // 消すと「何を踏み潰そうとしているか」が途中で見えなくなる。
  const opened = draft.kind === 'text' ? draft : null

  // 読めなかったときは、選ばれていない状態で開く。
  // 適当な既定を選んで開くと、そのまま送って黙って上書きされる。
  const unselected = values.kind === 'text' && values.templateKey === null
  const templateOptions = [
    ...(unselected ? [{ value: '', label: '選んでください' }] : []),
    ...templateKeys.map((k) => ({ value: k, label: TEXT_TEMPLATE_LABELS[k] })),
  ]

  const submit = (): void => {
    if (busy) return
    onSubmit(values)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const action = resolveInlineFormKey({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      target: event.target instanceof HTMLElement ? { tagName: event.target.tagName } : null,
    })
    // どの打鍵も外へ流さない。外には区切り・再生の割り当てがある。
    event.stopPropagation()
    if (action === 'contain') return
    event.preventDefault()
    if (action === 'dismiss') onDismiss()
    else submit()
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${PANEL_TITLES[values.kind]}をその場で決める`}
      onKeyDown={handleKeyDown}
      onFocusCapture={() => (focusInside.current = true)}
      onBlurCapture={(event) =>
        (focusInside.current = panelRef.current?.contains(event.relatedTarget) ?? false)
      }
      style={{ left: `${String(placement.leftPx)}px`, top: `${String(placement.topPx)}px` }}
      className="absolute z-20 w-64 rounded-lg border border-line-strong bg-surface p-3 shadow-lg"
    >
      <p className="text-sm font-semibold text-text">{PANEL_TITLES[values.kind]}</p>
      {caption === undefined ? null : <p className={`mt-0.5 ${FIELD_HINT_CLASS}`}>{caption}</p>}
      <div className="mt-3 space-y-3">
        {values.kind === 'transition' ? (
          <SelectField
            id={`${idPrefix}-type`}
            label="種類"
            value={values.type}
            options={transitionTypes.map((t) => ({ value: t, label: transitionTypeLabel(t) }))}
            disabled={busy}
            error={fieldError('type')}
            onChange={(next) => {
              const parsed = TransitionTypeSchema.safeParse(next)
              if (parsed.success) setValues({ ...values, type: parsed.data })
            }}
          />
        ) : (
          <>
            <div>
              <SelectField
                id={`${idPrefix}-template`}
                label="テンプレート"
                value={values.templateKey ?? ''}
                options={templateOptions}
                disabled={busy}
                error={fieldError('templateKey')}
                onChange={(next) => {
                  const parsed = TextTemplateKeySchema.safeParse(next)
                  setValues({ ...values, templateKey: parsed.success ? parsed.data : null })
                }}
              />
              {opened?.templateKey === null ? (
                <Unreadable>{UNREADABLE_TEMPLATE(opened.rawTemplateKey)}</Unreadable>
              ) : null}
            </div>
            <div>
              <TextField
                id={`${idPrefix}-text`}
                label="文字"
                value={values.text ?? ''}
                disabled={busy}
                error={fieldError('text')}
                onChange={(text) => setValues({ ...values, text })}
              />
              {opened?.text === null ? (
                <Unreadable>{UNREADABLE_TEXT}</Unreadable>
              ) : (
                <p className={`mt-1 ${FIELD_HINT_CLASS}`}>{TEXT_LENGTH_HINT}</p>
              )}
            </div>
            <TextField
              id={`${idPrefix}-start`}
              label="開始（秒）"
              value={values.startSec}
              disabled={busy}
              error={fieldError('startSec')}
              onChange={(startSec) => setValues({ ...values, startSec })}
            />
          </>
        )}
        <TextField
          id={`${idPrefix}-duration`}
          label="尺（秒）"
          value={values.durationSec}
          disabled={busy}
          error={fieldError('durationSec')}
          onChange={(durationSec) => setValues({ ...values, durationSec })}
        />
      </div>
      {notice === null ? null : (
        <p role="status" className="mt-3 rounded-md bg-warn/10 p-2 text-xs text-warn">
          {notice}
        </p>
      )}
      {errors?.form === undefined ? null : (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errors.form}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button tone="primary" size="sm" disabled={busy} onClick={submit}>
          {onRemove === undefined ? '置く' : '置き直す'}
        </Button>
        <Button size="sm" disabled={busy} onClick={onDismiss}>
          {WORDING.cancel}
        </Button>
        {onRemove === undefined ? null : (
          <Button size="sm" disabled={busy} onClick={onRemove}>
            {`${WORDING.delete}（${PANEL_TITLES[values.kind]}）`}
          </Button>
        )}
      </div>
    </div>
  )
}
