import { MusicTrackId, SequenceId, type MusicSection } from '@ixa/domain'
import type { AllocateShotsBody } from '@/lib/music-api'

/**
 * Shot 割りフォームの値と送信前検証。
 * 画面（React）から切り離した純粋関数にして、ブラウザ無しでテストできるようにする。
 */

/** Sequence 未選択を表す値。空文字だと select の初期状態と区別できない。 */
export const NO_SEQUENCE_VALUE = '__none__'

/** ビートグリッドの分解能。ADR-0017 の BeatSubdivision に対応する。 */
export const SUBDIVISION_OPTIONS = [
  { value: '1', label: '拍（1/4）' },
  { value: '0.5', label: '8分' },
  { value: '0.25', label: '16分' },
] as const

export type StoryboardFormValues = {
  readonly musicTrackId: string
  readonly sectionIndex: string
  readonly requestedCount: string
  readonly subdivision: string
  readonly sequenceId: string
}

export type StoryboardFormField = keyof StoryboardFormValues | 'form'

export type StoryboardFormErrors = Readonly<Partial<Record<StoryboardFormField, string>>>

export type StoryboardFormValidation =
  | { readonly ok: true; readonly input: AllocateShotsBody }
  | { readonly ok: false; readonly errors: StoryboardFormErrors }

export const initialStoryboardFormValues = (musicTrackId = ''): StoryboardFormValues => ({
  musicTrackId,
  sectionIndex: '0',
  requestedCount: '8',
  subdivision: '1',
  sequenceId: NO_SEQUENCE_VALUE,
})

const parseSubdivision = (raw: string): 1 | 0.5 | 0.25 | null => {
  if (raw === '1') return 1
  if (raw === '0.5') return 0.5
  if (raw === '0.25') return 0.25
  return null
}

const parseIntegerIn = (raw: string, min: number, max: number): number | null => {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < min || value > max) return null
  return value
}

/**
 * 1 セクションから作れるカット数の上限。
 * API 側はグリッドを見て減らすが、**桁を間違えた入力で何百 Shot も作られる**のを
 * 送る前に止める。実害があるのはこちら側（DB に行が残る）なので画面でも弾く。
 */
export const MAX_REQUESTED_COUNT = 200

export const validateStoryboardForm = (
  values: StoryboardFormValues,
  sections: readonly MusicSection[],
): StoryboardFormValidation => {
  const errors: Record<string, string> = {}

  const trackId = MusicTrackId.safeParse(values.musicTrackId)
  if (!trackId.success) errors.musicTrackId = '楽曲を選んでください'

  const sectionIndex = parseIntegerIn(values.sectionIndex, 0, Math.max(sections.length - 1, 0))
  if (sectionIndex === null || sections.length === 0) {
    errors.sectionIndex = 'セクションを選んでください'
  }

  const requestedCount = parseIntegerIn(values.requestedCount, 1, MAX_REQUESTED_COUNT)
  if (requestedCount === null) {
    errors.requestedCount = `カット数は 1〜${String(MAX_REQUESTED_COUNT)} の整数で入力してください`
  }

  const subdivision = parseSubdivision(values.subdivision)
  if (subdivision === null) errors.subdivision = '分解能を選んでください'

  let sequenceId: SequenceId | null = null
  if (values.sequenceId !== NO_SEQUENCE_VALUE) {
    const parsed = SequenceId.safeParse(values.sequenceId)
    if (!parsed.success) {
      errors.sequenceId = 'Sequence の指定が不正です'
    } else {
      sequenceId = parsed.data
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    input: {
      musicTrackId: trackId.data as MusicTrackId,
      sectionIndex: sectionIndex as number,
      requestedCount: requestedCount as number,
      subdivision: subdivision as 1 | 0.5 | 0.25,
      sequenceId,
    },
  }
}

/** `chorus 32.0–56.0s（24.0s）` のように、選ぶときに必要な情報だけを並べる。 */
export const describeSection = (section: MusicSection): string => {
  const length = section.end - section.start
  return `${section.label} ${section.start.toFixed(1)}–${section.end.toFixed(1)}s（${length.toFixed(1)}s）`
}
