import type { Character, CharacterId, DialogueLine } from '@ixa/domain'

/**
 * Shot のセリフの欄の下書き（ADR-0059）。**画面の中の書きかけ**で、保存する形（`DialogueLine`）とは別に持つ。
 * 足したばかりの行はセリフが空で、そのままでは保存できない（domain が空のセリフを拒む）。
 * 書きかけを残したまま、ほかの行の変更は保存できるようにする。
 */
export type DraftLine = {
  readonly speakerId: CharacterId | null
  readonly text: string
  readonly offscreen: boolean
  readonly translation: string | null
}

export const draftsFrom = (lines: readonly DialogueLine[]): readonly DraftLine[] =>
  lines.map((line) => ({
    speakerId: line.speakerId,
    text: line.text,
    offscreen: line.offscreen,
    translation: line.translation,
  }))

/** 話し手とセリフのある行だけを保存する形にする（書きかけの行は送らない）。 */
export const savableLines = (drafts: readonly DraftLine[]): DialogueLine[] =>
  drafts.flatMap((draft) => {
    const text = draft.text.trim()
    return draft.speakerId === null || text === ''
      ? []
      : [{ speakerId: draft.speakerId, text, offscreen: draft.offscreen, translation: translationFromInput(draft.translation ?? '') }]
  })

/** 保存した行が同じか（書きかけの行は比べない）。サーバの値で下書きを上書きするかの判断に使う。 */
export const sameSavedLines = (drafts: readonly DraftLine[], saved: readonly DialogueLine[]): boolean =>
  JSON.stringify(savableLines(drafts)) === JSON.stringify(saved)

/** 訳文の欄の値（ADR-0061。2 段字幕の下の段）。前後の空白を落とし、空なら訳文なし。 */
export const translationFromInput = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export const addDraftLine = (
  drafts: readonly DraftLine[],
  speakerId: CharacterId | null,
): readonly DraftLine[] => [...drafts, { speakerId, text: '', offscreen: false, translation: null }]

export const updateDraftLine = (
  drafts: readonly DraftLine[],
  index: number,
  patch: Partial<DraftLine>,
): readonly DraftLine[] => drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))

export const removeDraftLine = (drafts: readonly DraftLine[], index: number): readonly DraftLine[] =>
  drafts.filter((_, i) => i !== index)

/** `by` は -1（上へ）か 1（下へ）。端からは動かさない。 */
export const moveDraftLine = (drafts: readonly DraftLine[], index: number, by: -1 | 1): readonly DraftLine[] => {
  const target = index + by
  const moving = drafts[index]
  const other = drafts[target]
  if (moving === undefined || other === undefined) return drafts
  return drafts.map((draft, i) => (i === index ? other : i === target ? moving : draft))
}

type Choice = Pick<Character, 'id' | 'displayName'>

/**
 * 話し手の選択肢。**配役の人を先に**、配役にいない人（画面外の声）を後に分ける。
 * 配役がいなければ全キャラクターが後ろの組に入る。
 */
export const speakerChoices = (
  castIds: readonly CharacterId[],
  all: readonly Choice[],
): { readonly cast: readonly Choice[]; readonly others: readonly Choice[] } => ({
  cast: castIds.flatMap((id) => all.filter((c) => c.id === id)),
  others: all.filter((c) => !castIds.includes(c.id)),
})
