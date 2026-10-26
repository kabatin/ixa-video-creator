import type { DubReading } from './dub-record.js'

/**
 * 読み方を変えて試す（ADR-0062）。最大 3 通り（素の文／句読点の後に間／読点を外した文）を順に試し、
 * 口との一致率が一番高いものを使う。数が合い一致率 0.9 以上で打ち切る。
 */

/** Gemini の読み上げが解する「短い間」の印（本文に入れる）。 */
export const DUB_PAUSE_MARKER = '<short pause>'
/** これ以上の一致率で、区間の数も合えば、次の読み方を試さない。 */
export const DUB_GOOD_AGREEMENT = 0.9

export type ReadingVariant = { readonly kind: DubReading; readonly text: string }

/** 読ませる文。頭の「……」（間の印）は読まない。 */
export const spokenText = (text: string): string => text.replace(/^[…‥]+/u, '').trim()

/** 句読点の後（文の最後を除く）に間の印を入れる。 */
const withPauses = (text: string): string => text.replace(/([、。！？!?])(?!$)/gu, `$1${DUB_PAUSE_MARKER}`)

export const readingVariants = (text: string): readonly ReadingVariant[] => {
  const plain = spokenText(text)
  const candidates: readonly ReadingVariant[] = [
    { kind: 'plain', text: plain },
    { kind: 'pause', text: withPauses(plain) },
    { kind: 'no_comma', text: plain.replaceAll('、', '') },
  ]
  return candidates.filter((variant, index) => candidates.findIndex((other) => other.text === variant.text) === index)
}

export const shouldStopTrying = (attempt: { readonly countsMatched: boolean; readonly agreement: number | null }): boolean =>
  attempt.countsMatched && attempt.agreement !== null && attempt.agreement >= DUB_GOOD_AGREEMENT

/** 一致率の一番高いもの（同じなら先に試したもの）。試していなければ null。 */
export const pickReading = <T extends { readonly agreement: number | null }>(attempts: readonly T[]): T | null =>
  attempts.reduce<T | null>((best, attempt) => ((attempt.agreement ?? -1) > (best?.agreement ?? -1) ? attempt : best), null)
