/**
 * サムネイルの文字の折り返しと大きさ（ADR-0051）。**純粋な関数だけ。**
 *
 * 折り返しを CSS（ブラウザ）に任せると、画面の Player と worker の Chrome で切れ目が変わりうるうえ、
 * 狭い左の列では英単語の途中で切れた（「NIGH / T / RUN」。2026-10-17 の実機）。
 * だから**行をここで決め、1 行ずつ描く**（描く側は折り返さない）。プレビューと書き出しが同じ行になる。
 *
 * 切ってよいのは「空白」と「和文の字の間」だけ。英数字の並びは 1 つの塊として切らない。
 * 行頭に来てはいけない閉じ括弧・句読点は前の字に、行末に残してはいけない開き括弧は次の字に付ける（禁則）。
 * 字の幅はフォントを測らずに見積もる（太字 900 で少し広めに取る）。広めなので、はみ出すより小さくなる側に倒れる。
 */

/** 折り返しの単位。`spaceBefore` は前に空白があった（そこで切ってよく、行の途中なら空白の幅を足す）。 */
export type TextAtom = { readonly text: string; readonly spaceBefore: boolean }

/** 行頭に置かない字（閉じ括弧・句読点・長音など）。前の塊に付ける。 */
const NO_LINE_START = new Set([...'）」』】〕〉》］｝、。，．・：；？！ー…‥ァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎ)]},.!?:;%'])
/** 行末に置かない字（開き括弧）。次の塊に付ける。 */
const NO_LINE_END = new Set([...'（「『【〔〈《［｛([{'])

/** 英数字と、英語の中に出てくる記号。続く限り 1 つの塊にする（単語を切らない）。 */
const isLatin = (char: string): boolean => /^[!-~À-ɏ]$/.test(char) && !NO_LINE_END.has(char)

const isSpace = (char: string): boolean => /^\s$/.test(char) || char === '　'

/** 文字列を折り返しの単位に分ける。 */
export const tokenizeTitle = (text: string): readonly TextAtom[] => {
  type Draft = { text: string; spaceBefore: boolean; latin: boolean }
  const drafts: Draft[] = []
  let pendingSpace = false
  let pendingOpen = ''
  for (const char of [...text]) {
    if (isSpace(char)) {
      pendingSpace = drafts.length > 0 || pendingOpen !== ''
      continue
    }
    if (NO_LINE_END.has(char)) {
      pendingOpen += char
      continue
    }
    const last = drafts.at(-1)
    if (last !== undefined && pendingOpen === '' && !pendingSpace && NO_LINE_START.has(char)) {
      drafts[drafts.length - 1] = { ...last, text: last.text + char }
      continue
    }
    const latin = isLatin(char)
    if (last !== undefined && latin && last.latin && pendingOpen === '' && !pendingSpace) {
      drafts[drafts.length - 1] = { ...last, text: last.text + char }
      continue
    }
    drafts.push({ text: pendingOpen + char, spaceBefore: pendingSpace, latin })
    pendingSpace = false
    pendingOpen = ''
  }
  // 末尾に残った開き括弧は、行末に置くしかないので最後の塊に付ける。
  const tail = drafts.at(-1)
  if (pendingOpen !== '') {
    if (tail === undefined) drafts.push({ text: pendingOpen, spaceBefore: false, latin: false })
    else drafts[drafts.length - 1] = { ...tail, text: tail.text + pendingOpen }
  }
  return drafts.map(({ text: atomText, spaceBefore }) => ({ text: atomText, spaceBefore }))
}

/** 空白の幅（字の高さ = 1）。 */
export const SPACE_EM = 0.3

/**
 * 1 字の幅の見積もり（字の高さ = 1）。太字 900 の和文書体（ヒラギノ角ゴ W9 など）の英字は普通より広い。
 * 実機の書き出しで「NIGHT」は 100px で約 366px（大文字 1 字 0.73）だったので、それより広めに取る。
 */
const charEm = (char: string): number => {
  if (isSpace(char)) return SPACE_EM
  if (/^[A-Z]$/.test(char)) return 0.8
  if (/^[a-z]$/.test(char)) return 0.64
  if (/^[0-9]$/.test(char)) return 0.68
  if (/^[!-~]$/.test(char)) return 0.45
  return 1
}

export const textWidthEm = (text: string): number => [...text].reduce((sum, char) => sum + charEm(char), 0)

/** 塊を前から詰めて行にする（入るだけ入れて、入らなければ次の行）。幅は字の高さを 1 とした値。 */
export const wrapAtoms = (atoms: readonly TextAtom[], maxWidthEm: number): readonly string[] =>
  atoms.reduce<readonly string[]>((lines, atom) => {
    const current = lines.at(-1)
    if (current === undefined) return [atom.text]
    const joined = atom.spaceBefore ? `${current} ${atom.text}` : current + atom.text
    return textWidthEm(joined) <= maxWidthEm ? [...lines.slice(0, -1), joined] : [...lines, atom.text]
  }, [])

export type FitBox = {
  /** 文字を置ける幅（px）。 */
  readonly width: number
  /** 文字を置ける高さ（px）。 */
  readonly height: number
  readonly maxLines: number
  readonly maxSize: number
  readonly minSize: number
  readonly lineHeight: number
  /** 縁取り・影のぶん、幅に取っておく割合（字の高さに対して）。 */
  readonly strokeEm: number
}

export type FittedText = { readonly size: number; readonly lines: readonly string[] }

const SIZE_STEP = 2

const fitsAt = (atoms: readonly TextAtom[], box: FitBox, size: number): FittedText | null => {
  const maxWidthEm = box.width / size - box.strokeEm
  const lines = wrapAtoms(atoms, maxWidthEm)
  const wide = lines.some((line) => textWidthEm(line) > maxWidthEm)
  const tall = lines.length * size * box.lineHeight > box.height
  return lines.length <= box.maxLines && !wide && !tall ? { size, lines } : null
}

/** 塊そのものが幅より広い（1 語が長すぎる）ときの最後の手段。字ごとに切る。 */
const splitByChar = (atoms: readonly TextAtom[]): readonly TextAtom[] =>
  atoms.flatMap((atom) => [...atom.text].map((char, index) => ({ text: char, spaceBefore: index === 0 && atom.spaceBefore })))

/**
 * いちばん大きく入る大きさと、そのときの行。上限から 2 px ずつ下げ、行数・幅・高さがすべて収まった所で止める。
 * 下限でも入らなければ、下限の大きさで字ごとに切った行を返す（はみ出しても描けなくなるよりよい。40 字の 1 語など）。
 */
export const fitText = (text: string, box: FitBox): FittedText => {
  const atoms = tokenizeTitle(text)
  for (let size = box.maxSize; size >= box.minSize; size -= SIZE_STEP) {
    const fitted = fitsAt(atoms, box, size)
    if (fitted !== null) return fitted
  }
  const byChar = splitByChar(atoms)
  const forced = fitsAt(byChar, box, box.minSize)
  return forced ?? { size: box.minSize, lines: wrapAtoms(byChar, box.width / box.minSize - box.strokeEm) }
}
