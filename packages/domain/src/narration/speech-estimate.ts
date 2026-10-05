import type { AppliedReading } from './reading.js'

/**
 * 話す長さの見積もり（ADR-0038）。声にする前に「約 2.4 秒」と出し、作品の長さ（15 秒 CM など）に収まるかを見る。
 *
 * 数えるのは読みの拍（モーラ）。読みに漢字・数字・英字が残っていれば、平均的な拍数で見積もる。
 * 実際の長さは声の AI と「声のイメージ」で変わるので、画面では必ず「約」を付ける。
 */

/** ナレーションの速さ（拍/秒）。アナウンサーの読み（約 8）より少しゆっくりめ。 */
export const NARRATION_MORA_PER_SEC = 7

const SHORT_PAUSE_SEC = 0.25
const LONG_PAUSE_SEC = 0.5

const KANA = /[ぁ-ゖァ-ヺー]/u
/** 前の字と合わせて 1 拍になる小さい字（「っ」「ッ」は 1 拍なので含めない）。 */
const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/u
const KANJI = /[一-鿿々]/u
const DIGIT = /[0-9０-９]/u
const LATIN = /[A-Za-zＡ-Ｚａ-ｚ]/u
const SHORT_PAUSE = /[、,，]/u
const LONG_PAUSE = /[。．！？!?]/u

const moraOf = (char: string): number => {
  if (SMALL_KANA.test(char)) return 0
  if (KANA.test(char)) return 1
  if (KANJI.test(char) || DIGIT.test(char)) return 2
  if (LATIN.test(char)) return 1.5
  return 0
}

const pauseOf = (char: string): number => {
  if (SHORT_PAUSE.test(char)) return SHORT_PAUSE_SEC
  if (LONG_PAUSE.test(char)) return LONG_PAUSE_SEC
  return 0
}

/** 読みの拍の数。句読点・記号・空白は数えない。 */
export const countMora = (reading: string): number =>
  [...reading].reduce((total, char) => total + moraOf(char), 0)

/** 行の終わりの句読点・閉じかっこ・空白。声はそこで終わるので、間に数えない。 */
const TRAILING = /[\s、,，。．！？!?」』）)】〕"'”’]+$/u

/**
 * 話す長さ（秒、0.1 秒に丸める）。速さは声の設定（1 が標準）。句読点の間は速さで変えない。
 * 行の終わりの句読点は数えない（実測で、句点の分だけ見積もりが長く出ていた）。
 */
export const estimateSpeechSec = (reading: string, speed: number): number => {
  const pauses = [...reading.replace(TRAILING, '')].reduce((total, char) => total + pauseOf(char), 0)
  const seconds = countMora(reading) / (NARRATION_MORA_PER_SEC * speed) + pauses
  return Math.round(seconds * 10) / 10
}

/** 1 字を話す長さの見積もり（秒、速さ 1）。拍と句読点の間から。 */
export const charSpeechSeconds = (char: string): number => moraOf(char) / NARRATION_MORA_PER_SEC + pauseOf(char)

/**
 * 表示の字ごとの「話す長さの重み」。字の時刻が無い声で、テロップを按分するのに使う。
 * 置き換えた言葉（戦子 → せんこ）は、読みの長さを表示の字数で等分する（漢字の数で数えない）。
 */
export const displaySpeechWeights = (applied: AppliedReading): readonly number[] => {
  const reading = [...applied.reading]
  const display = [...applied.display]
  return applied.spans.flatMap((span) => {
    const chars = display.slice(span.display.start, span.display.end)
    if (!span.replaced) return chars.map(charSpeechSeconds)
    const total = reading.slice(span.reading.start, span.reading.end).reduce((sum, char) => sum + charSpeechSeconds(char), 0)
    return chars.map(() => total / chars.length)
  })
}
