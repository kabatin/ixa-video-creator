import { describe, expect, it } from 'vitest'
import { assignLines } from '../dub/assign-lines.js'
import { matchSimilarity, normalizeForMatch } from '../dub/text-similarity.js'

/**
 * 行の区間を、文字起こしの語で決める（ADR-0062）。語を行に文の近さで割り当て、声の区間に写す。
 * 決められなければ読み上げの長さに任せ、その痕跡を警告に残す。
 */

const c = (startSec: number, endSec: number) => ({ startSec, endSec })
const w = (startSec: number, endSec: number, text: string) => ({ startSec, endSec, text })
const tts = (entries: readonly (readonly [number, readonly number[]])[]) => new Map(entries)
const spansOf = (result: ReturnType<typeof assignLines>) =>
  result.ok ? result.spans.map((span) => [span.lineIndex, span.startSec, span.endSec, span.source]) : result.reason
const codesOf = (result: ReturnType<typeof assignLines>) => (result.ok ? result.warnings.map((x) => [x.lineIndex, x.warning.code]) : result.reason)

/** 実の H3 の Take（6.58 秒）の声の区間（最大 −30 dB）。 */
const REAL_CHUNKS = [c(0.0, 0.15), c(1.57, 2.45), c(2.97, 3.69), c(3.76, 4.13), c(4.86, 5.0), c(5.46, 6.03), c(6.07, 6.28)]
const REAL_LINES = [{ text: 'ねえ、ネズミくん。' }, { text: 'な、なんですか。' }]
/** 長さだけでは 1 行目を (1.57, 2.45)・2 行目を (2.97, 4.13) にしてしまう読み上げの長さ。 */
const REAL_TTS = tts([
  [0, [1.39]],
  [1, [1.16]],
])

describe('文字の比べ方', () => {
  it('句読点・促音・長音を除き、カタカナをひらがなにそろえる', () => {
    expect(normalizeForMatch('ねえ、ネズミくん。')).toBe('ねえねずみくん')
    expect(normalizeForMatch('なっ')).toBe('な')
    expect(normalizeForMatch('ちょっと…待ってー！')).toBe('ちよと待て')
  })

  it('漢字と仮名の食い違い（何ですか／なんですか）でも、別の文よりずっと近い', () => {
    const line = normalizeForMatch('な、なんですか。')
    expect(matchSimilarity(normalizeForMatch('何ですか'), line)).toBeGreaterThan(0.5)
    expect(matchSimilarity(normalizeForMatch('ねずみくん'), line)).toBeLessThan(0.2)
  })
})

describe('assignLines（文字起こしの語で割り当てる）', () => {
  it('実の Take、文字起こしの区切り（1.04〜4.76「ねえねずみくん」・4.76〜6.06「な何ですか」）だけでも、正しい区間になる', () => {
    const words = [w(1.04, 4.76, 'ねえねずみくん'), w(4.76, 6.06, 'な何ですか')]
    const result = assignLines(REAL_CHUNKS, REAL_LINES, REAL_TTS, words)
    expect(result).toEqual({
      ok: true,
      spans: [
        { lineIndex: 0, startSec: 1.57, endSec: 4.13, source: 'chunks', chunks: [c(1.57, 2.45), c(2.97, 3.69), c(3.76, 4.13)] },
        { lineIndex: 1, startSec: 4.86, endSec: 6.28, source: 'chunks', chunks: [c(4.86, 5.0), c(5.46, 6.03), c(6.07, 6.28)] },
      ],
      warnings: [],
    })
  })

  it('実の Take、語ごとの時刻（頭の「はっ」を含む）でも、「はっ」のクリックを行に入れない', () => {
    const words = [w(0.0, 0.15, 'はっ'), w(1.04, 2.4, 'ねえ'), w(2.4, 4.76, 'ねずみくん'), w(4.76, 5.3, 'な'), w(5.3, 6.06, '何ですか')]
    const result = assignLines(REAL_CHUNKS, REAL_LINES, REAL_TTS, words)
    expect(spansOf(result)).toEqual([
      [0, 1.57, 4.13, 'chunks'],
      [1, 4.86, 6.28, 'chunks'],
    ])
    // 読み上げの長さの決め手に頼らず、文だけで決まる（迷いの警告も無い）
    expect(codesOf(result)).toEqual([])
    expect(spansOf(assignLines(REAL_CHUNKS, REAL_LINES, undefined, words))).toEqual([
      [0, 1.57, 4.13, 'chunks'],
      [1, 4.86, 6.28, 'chunks'],
    ])
  })

  it('飛ばした語（息）の声の区間は、行のすぐ前にあっても行に入れない。語に重ならない区間は 0.15 秒以内なら近い行に入れる', () => {
    const chunks = [c(1.3, 1.45), c(1.57, 2.45), c(2.55, 2.7)]
    const words = [w(1.3, 1.45, 'はっ'), w(1.57, 2.45, 'ねえ')]
    expect(spansOf(assignLines(chunks, [{ text: 'ねえ' }], undefined, words))).toEqual([[0, 1.57, 2.7, 'chunks']])
  })

  it('上位 2 つの語の割り当てが同じくらいなら、読み上げの長さで決め、長さでも決まらなければ迷いの警告を付ける', () => {
    // 同じ文の 2 行に「はい」が 3 つ。どの 2 つを使っても文の近さは同じ
    const chunks = [c(0.5, 1.0), c(1.2, 1.4), c(2.0, 2.8)]
    const lines = [{ text: 'はい' }, { text: 'はい。' }]
    const words = [w(0.5, 1.0, 'はい'), w(1.2, 1.4, 'はい'), w(2.0, 2.8, 'はい')]
    const long = assignLines(chunks, lines, tts([[0, [0.5]], [1, [0.8]]]), words)
    expect(spansOf(long)).toEqual([
      [0, 0.5, 1.0, 'chunks'],
      [1, 2.0, 2.8, 'chunks'],
    ])
    expect(codesOf(long)).toEqual([])
    expect(spansOf(assignLines(chunks, lines, tts([[0, [0.5]], [1, [0.2]]]), words))).toEqual([
      [0, 0.5, 1.0, 'chunks'],
      [1, 1.2, 1.4, 'chunks'],
    ])
    expect(codesOf(assignLines(chunks, lines, undefined, words))).toEqual([[1, 'line_span_ambiguous']])
  })

  it('2 行が 1 つの区切りにまとまっても、語が分かれていれば行ごとに分ける', () => {
    // faster-whisper は台本を渡すと、続けて話した 2 行を 1 つの区切りにし、語を 1〜2 文字ずつに分ける（macOS の say で確かめた形）
    const words = [
      w(1.6, 2.0, 'ね'),
      w(2.0, 2.4, 'え、'),
      w(2.97, 3.2, 'ネ'),
      w(3.2, 3.4, 'ズ'),
      w(3.4, 3.69, 'ミ'),
      w(3.76, 3.95, 'く'),
      w(3.95, 4.13, 'ん。'),
      w(4.86, 5.0, 'な、'),
      w(5.46, 5.7, 'なん'),
      w(5.7, 6.25, 'ですか。'),
    ]
    expect(spansOf(assignLines(REAL_CHUNKS, REAL_LINES, REAL_TTS, words))).toEqual([
      [0, 1.57, 4.13, 'chunks'],
      [1, 4.86, 6.28, 'chunks'],
    ])
  })

  it('漢字と仮名が食い違っても（行くぞ／いくぞ・待って／まって）、長さでなく文で割り当てる', () => {
    const chunks = [c(0.3, 0.6), c(1.0, 1.9), c(2.5, 2.8)]
    const lines = [{ text: 'いくぞ！' }, { text: '待って。' }]
    const words = [w(0.25, 0.65, '行くぞ'), w(0.95, 1.95, 'まって')]
    // 長さだけなら 0.9 秒の区間が 1 行目に近い（読み上げ 0.8 / 0.3 秒）
    const result = assignLines(chunks, lines, tts([[0, [0.8]], [1, [0.3]]]), words)
    expect(spansOf(result)).toEqual([
      [0, 0.3, 0.6, 'chunks'],
      [1, 1.0, 1.9, 'chunks'],
    ])
  })

  it('文字起こしが使えなければ（null）、読み上げの長さで割り当て、行ごとにその痕跡を警告に残す', () => {
    const result = assignLines(REAL_CHUNKS, REAL_LINES, REAL_TTS, null)
    expect(spansOf(result)).toEqual([
      [0, 1.57, 2.45, 'chunks'],
      [1, 2.97, 4.13, 'chunks'],
    ])
    expect(codesOf(result)).toEqual([
      [0, 'line_span_by_length'],
      [1, 'line_span_by_length'],
    ])
  })

  it('文字起こしが行と合わなければ（別の文）、読み上げの長さで割り当て、警告を残す', () => {
    const words = [w(1.04, 4.76, 'こんにちは'), w(4.76, 6.06, 'さようなら')]
    const result = assignLines(REAL_CHUNKS, REAL_LINES, REAL_TTS, words)
    expect(spansOf(result)).toEqual([
      [0, 1.57, 2.45, 'chunks'],
      [1, 2.97, 4.13, 'chunks'],
    ])
    expect(codesOf(result)).toEqual([
      [0, 'line_span_by_length'],
      [1, 'line_span_by_length'],
    ])
  })

  it('語の数が行より少ない（1 語に 2 行がまとまった）なら、読み上げの長さに任せる', () => {
    const words = [w(1.04, 6.06, 'ねえねずみくんななんですか')]
    const result = assignLines(REAL_CHUNKS, REAL_LINES, REAL_TTS, words)
    expect(codesOf(result)).toEqual([
      [0, 'line_span_by_length'],
      [1, 'line_span_by_length'],
    ])
  })

  it('声の区間を 1 つも受け持たない行がある・語の時刻の順が行の順と入れ替わるなら、読み上げの長さに任せる', () => {
    const chunks = [c(1.0, 2.0), c(3.0, 4.0)]
    const lines = [{ text: 'ねえ' }, { text: 'なに' }]
    const lengths = tts([[0, [1.0]], [1, [1.0]]])
    const noChunk = assignLines(chunks, lines, lengths, [w(1.0, 2.0, 'ねえ'), w(2.3, 2.6, 'なに')])
    expect(codesOf(noChunk)).toEqual([
      [0, 'line_span_by_length'],
      [1, 'line_span_by_length'],
    ])
    const swapped = assignLines(chunks, lines, lengths, [w(3.0, 4.0, 'ねえ'), w(1.0, 2.0, 'なに')])
    expect(codesOf(swapped)).toEqual([
      [0, 'line_span_by_length'],
      [1, 'line_span_by_length'],
    ])
  })

  it('手の区間の行はそのまま、足す行は数えず、残りの行を文字起こしで割り当てる', () => {
    const lines = [{ text: 'ねえ、ネズミくん。', dub: { startSec: 1.5, endSec: 4.2 } }, { text: '足す', dub: { added: true } }, { text: 'な、なんですか。' }]
    const words = [w(1.04, 4.76, 'ねえねずみくん'), w(4.76, 6.06, 'な何ですか')]
    expect(spansOf(assignLines(REAL_CHUNKS, lines, tts([[2, [1.16]]]), words))).toEqual([
      [0, 1.5, 4.2, 'manual'],
      [2, 4.86, 6.28, 'chunks'],
    ])
  })

  it('文字起こしを渡さなければ（undefined）、前と同じく警告なしで読み上げの長さで割り当てる', () => {
    expect(codesOf(assignLines(REAL_CHUNKS, REAL_LINES, REAL_TTS))).toEqual([])
  })
})
