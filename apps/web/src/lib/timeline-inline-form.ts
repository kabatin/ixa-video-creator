import type { TextTemplateKey, TransitionType } from '@ixa/domain'

/**
 * `components/timeline-inline-form.tsx` の判定部分。**React を含まない。**
 *
 * 部品は表示だけを持ち、判定はここに置く。`.tsx` に混ぜると node 環境の
 * テストから使えず、描画を起こさないと確かめられない。
 *
 * ここにあるのは「画面の都合」だけで、**挿せるかどうかの検証は含まない**
 * （それは `timeline-insert.ts` が持つ / lessons L-016）。
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
