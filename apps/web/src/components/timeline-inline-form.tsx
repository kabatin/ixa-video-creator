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
import { WORDING } from '@/lib/wording'

/**
 * 帯の上のその場に浮く、小さな入力（P57-4）。狭い場所に浮くことを前提にする。
 *
 * **判定はここに書かない。** 秒の読み取り・重なり・隙間の検証は
 * `lib/timeline-insert.ts` が持つ。この部品は打たれた値をそのまま上へ返し、
 * 返ってきた `errors` を出すだけにする（lessons L-016）。
 * **絵に出ない種別の注意も登録簿から作る。** 書き写さず毎回訊く。
 */

// --- 上と交わす値 ---

/** トランジションの下書き。秒は打たれたままの文字列で返す（黙って 0 に落とさない）。 */
export type InlineTransitionDraft = {
  readonly kind: 'transition'
  readonly type: TransitionType
  readonly durationSec: string
}

/**
 * テロップの下書き。**読めなかった値は `null`。空文字に畳まない。** 畳むと
 * 「空のテロップ」と「壊れて読めないテロップ」が同じ見た目になり、送った瞬間に
 * 古い内容を黙って踏み潰す（domain の `parseTextClipParams` と同じ / L-015）。
 * 送信値でも `null` のまま返すので、受け側が `?? ''` で畳んでから検証へ渡す。
 */
export type InlineTextDraft = {
  readonly kind: 'text'
  readonly templateKey: TextTemplateKey | null
  /** 保存されていた生の値。読めなかったときだけ入る。何を踏み潰すのかを見せる。 */
  readonly rawTemplateKey?: string
  readonly text: string | null
  readonly startSec: string
  readonly durationSec: string
}

/** 初期値としても、送信値としても同じ形を使う。 */
export type InlineFormDraft = InlineTransitionDraft | InlineTextDraft

/** 欄の名前。`errors.fields` のキーはこれだけ。 */
export type InlineFieldName =
  keyof Omit<InlineTransitionDraft, 'kind'> | keyof Omit<InlineTextDraft, 'kind'>

const FIELD_NAMES: ReadonlySet<string> = new Set<InlineFieldName>([
  'type',
  'durationSec',
  'templateKey',
  'text',
  'startSec',
])

/**
 * 検証の結果。**この部品は中身を解釈しない。** `fields` は欄の直下、`form` は
 * ボタンの上へ。どの欄でもない不備を欄に押し込むと、直せない欄にエラーが付く。
 */
export type InlineFormErrors = {
  readonly fields?: Readonly<Partial<Record<InlineFieldName, string>>>
  readonly form?: string
}

/** 検証側が返す指摘。`timeline-insert.ts` の `InsertIssue` がこの形を満たす。 */
export type InlineFormIssue = { readonly field: string; readonly message: string }

/**
 * 指摘を表示用に畳む。**知らない欄名の指摘を捨てない。** 捨てると
 * 「押したのに何も起きない」になるので `form` へ回す（lessons L-015）。
 * 同じ欄に複数あるときは先頭を採る（欄の下に出せるのは 1 行なので）。
 */
export const inlineFormErrors = (issues: readonly InlineFormIssue[]): InlineFormErrors => {
  const fields = issues.reduce<Partial<Record<InlineFieldName, string>>>((acc, issue) => {
    if (!FIELD_NAMES.has(issue.field) || issue.field in acc) return acc
    return { ...acc, [issue.field]: issue.message }
  }, {})
  const rest = issues.filter((issue) => !FIELD_NAMES.has(issue.field)).map((i) => i.message)
  return {
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
    ...(rest.length > 0 ? { form: rest.join(' / ') } : {}),
  }
}

// --- 画面の端で切れないようにする ---

/** 出したい場所。x は**帯の上の点**（境目やクリップの中心）、y は帯の下端を渡す。 */
export type InlineFormAnchor = { readonly leftPx: number; readonly topPx: number }

export type InlinePanelBox = { readonly widthPx: number; readonly heightPx: number }

export type InlinePanelPlacement = {
  readonly leftPx: number
  readonly topPx: number
  /** 下に入らなかったので上へ返した。 */
  readonly placedAbove: boolean
}

/** 器の縁からこれだけは離す。0 にすると枠線が縁と重なって切れて見える。 */
export const INLINE_PANEL_MARGIN_PX = 8
const clampWithin = (value: number, min: number, max: number): number =>
  max < min ? min : Math.min(Math.max(value, min), max)

/**
 * 浮かせる場所を器の中へ収める。**React を含まない純粋関数。** 横は点を中心に、
 * はみ出す分だけ内側へ。縦は下が既定で、入らず上が広ければ上へ返す。
 */
export const clampInlinePanelPosition = (
  anchor: InlineFormAnchor,
  panel: InlinePanelBox,
  container: InlinePanelBox,
): InlinePanelPlacement => {
  const margin = INLINE_PANEL_MARGIN_PX
  const roomBelow = container.heightPx - anchor.topPx
  const placedAbove = roomBelow < panel.heightPx + margin && anchor.topPx > roomBelow
  const wantedTop = placedAbove ? anchor.topPx - panel.heightPx - margin : anchor.topPx + margin

  return {
    leftPx: clampWithin(
      anchor.leftPx - panel.widthPx / 2,
      margin,
      container.widthPx - panel.widthPx - margin,
    ),
    topPx: clampWithin(wantedTop, margin, container.heightPx - panel.heightPx - margin),
    placedAbove,
  }
}

// --- 打鍵の行き先 ---

export type InlineFormKeyEvent = {
  readonly key: string
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly target: { readonly tagName: string } | null
}

/**
 * 打鍵の行き先。**`null` を返さない。** 当てはまらないものは `contain`＝受け止めて
 * 外へ流さない。文字を打っただけで区切りが置かれてはいけない（lessons L-018）。
 */
export type InlineFormKeyAction = 'submit' | 'dismiss' | 'contain'

/** Enter で自分が反応する要素。ここで送ると押した操作と二重に効く。 */
const SELF_HANDLING_TAGS: ReadonlySet<string> = new Set(['BUTTON', 'TEXTAREA'])
export const resolveInlineFormKey = (event: InlineFormKeyEvent): InlineFormKeyAction => {
  if (event.key === 'Escape') return 'dismiss'
  if (event.key !== 'Enter') return 'contain'
  if (event.shiftKey || event.ctrlKey || event.metaKey) return 'contain'
  return SELF_HANDLING_TAGS.has((event.target?.tagName ?? '').toUpperCase()) ? 'contain' : 'submit'
}

const probe = (key: string): InlineFormKeyEvent => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  target: null,
})

/** この入力が開いている間に受け止める打鍵。 */
const CLAIMED_KEYS: readonly string[] = ['Enter', 'Escape']

const KEY_ACTION_LABELS: Readonly<Record<InlineFormKeyAction, string>> = {
  submit: '送る',
  dismiss: '閉じる',
  contain: '入力欄に入る（外の操作には効かない）',
}

export type InlineFormKeyHelp = { readonly keys: string; readonly action: string }

/** 画面に出す一覧。**手で書かず判定に通して作る**（lessons L-018）。 */
export const describeInlineFormKeys = (): readonly InlineFormKeyHelp[] =>
  CLAIMED_KEYS.map((keys) => ({
    keys,
    action: KEY_ACTION_LABELS[resolveInlineFormKey(probe(keys))],
  }))

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
  <p role="alert" className="mt-1 text-xs text-red-700">
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
      className="absolute z-20 w-64 rounded-lg border border-slate-300 bg-white p-3 shadow-lg"
    >
      <p className="text-sm font-semibold text-slate-900">{PANEL_TITLES[values.kind]}</p>
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
        <p role="status" className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          {notice}
        </p>
      )}
      {errors?.form === undefined ? null : (
        <p role="alert" className="mt-3 text-sm text-red-700">
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
