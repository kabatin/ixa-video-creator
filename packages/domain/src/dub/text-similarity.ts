/**
 * 文字起こしの語とセリフの行の文の近さ（ADR-0062）。純粋。
 *
 * 文字起こしは漢字と仮名がセリフと食い違う（「何ですか」と「なんですか」）ので、同じかどうかでは比べない。
 * 句読点・空白・記号・促音・長音を除き、カタカナをひらがなに、小さな仮名を大きな仮名にそろえてから、
 * 1 文字と 2 文字の重なり（Dice）と、文の終わりの 1 文字が同じか（「か」「ん」などの終わりの語）で測る。
 */

const KATAKANA_START = 0x30a1
const KATAKANA_END = 0x30f6
const KANA_OFFSET = 0x60

const SMALL_KANA: Readonly<Record<string, string>> = {
  ぁ: 'あ',
  ぃ: 'い',
  ぅ: 'う',
  ぇ: 'え',
  ぉ: 'お',
  ゃ: 'や',
  ゅ: 'ゆ',
  ょ: 'よ',
  ゎ: 'わ',
  ゕ: 'か',
  ゖ: 'け',
}

/** 除く文字（促音・長音・繰り返しの印）。句読点・空白・記号は Unicode の種類で除く。 */
const DROPPED = new Set(['っ', 'ー', 'ゝ', 'ゞ', '〜'])

const toHiragana = (char: string): string => {
  const code = char.codePointAt(0) ?? 0
  return code >= KATAKANA_START && code <= KATAKANA_END ? String.fromCodePoint(code - KANA_OFFSET) : char
}

/** 比べるための文字の並び。 */
export const normalizeForMatch = (text: string): string =>
  [...text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')]
    .map(toHiragana)
    .map((char) => SMALL_KANA[char] ?? char)
    .filter((char) => !DROPPED.has(char))
    .join('')

const countsOf = (items: readonly string[]): ReadonlyMap<string, number> =>
  items.reduce((acc, item) => new Map([...acc, [item, (acc.get(item) ?? 0) + 1]]), new Map<string, number>())

const bigramsOf = (chars: readonly string[]): readonly string[] => chars.slice(1).map((char, k) => `${chars[k] ?? ''}${char}`)

/** 重なりの数（多重集合）。 */
const commonCount = (a: readonly string[], b: readonly string[]): number => {
  const counts = countsOf(b)
  return [...countsOf(a)].reduce((sum, [item, n]) => sum + Math.min(n, counts.get(item) ?? 0), 0)
}

const dice = (a: readonly string[], b: readonly string[]): number =>
  a.length + b.length === 0 ? 0 : (2 * commonCount(a, b)) / (a.length + b.length)

const UNIGRAM_WEIGHT = 0.45
const BIGRAM_WEIGHT = 0.45
const ENDING_WEIGHT = 0.1

/** そろえた 2 つの文の近さ（0〜1）。どちらかが空なら 0。 */
export const matchSimilarity = (a: string, b: string): number => {
  const x = [...a]
  const y = [...b]
  if (x.length === 0 || y.length === 0) return 0
  const unigram = dice(x, y)
  const bigram = x.length < 2 || y.length < 2 ? unigram : dice(bigramsOf(x), bigramsOf(y))
  const ending = x[x.length - 1] === y[y.length - 1] ? 1 : 0
  return UNIGRAM_WEIGHT * unigram + BIGRAM_WEIGHT * bigram + ENDING_WEIGHT * ending
}

/** `group` の文字のうち、`line` に無い（数を超えた）文字の数。 */
export const foreignCount = (group: string, line: string): number => {
  const x = [...group]
  return x.length - commonCount(x, [...line])
}
