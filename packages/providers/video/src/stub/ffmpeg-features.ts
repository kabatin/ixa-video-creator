import { runFfmpeg, type RunOptions } from '@ixa/media'

/**
 * FFmpeg のビルドによっては `drawtext`（libfreetype 依存）が含まれない。
 * 例: Homebrew の `ffmpeg` 9.x は分割され、freetype 系は `ffmpeg-full` 側にしか入らない。
 * 特定の環境に縛られないよう、有無を実行時に判定して縮退できるようにする。
 */

/**
 * `ffmpeg -filters` の出力から drawtext の有無を判定する純粋関数。
 * 各行は `<flags> <name> <io> <description>` の形で、説明文にも filter 名が出てくるため、
 * **2 列目のフィルタ名だけ**を見る。
 */
export const hasFilter = (filtersOutput: string, filterName: string): boolean =>
  filtersOutput
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .some((columns) => columns.length >= 2 && columns[1] === filterName)

export const hasDrawtext = (filtersOutput: string): boolean => hasFilter(filtersOutput, 'drawtext')

/** drawtext があっても強制的に縮退させる env。縮退時の挙動を検証するために使う。 */
export const STUB_FORCE_NO_DRAWTEXT_ENV = 'STUB_FORCE_NO_DRAWTEXT'

/** env 値の解釈。未設定・空・`0`・`false` 以外はすべて「強制縮退する」とみなす。 */
export const isForcedNoDrawtext = (value: string | undefined): boolean => {
  if (value === undefined || value === '') return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '0' && normalized !== 'false'
}

/** 実 ffmpeg を呼ぶ判定はこの 1 箇所に閉じる。プロセス起動は初回だけ。 */
let cachedSupport: Promise<boolean> | null = null

const probeDrawtext = async (options?: RunOptions): Promise<boolean> => {
  try {
    const { stdout } = await runFfmpeg(['-hide_banner', '-filters'], options)
    return hasDrawtext(stdout)
  } catch {
    // ffmpeg 自体が壊れている場合はここでは判断せず、実際の生成時のエラーに任せる
    // （FfmpegError は stderr を保持したまま renderPlaceholder から再送出される）。
    return false
  }
}

export const detectDrawtextSupport = (options?: RunOptions): Promise<boolean> => {
  // 強制縮退はキャッシュしない。env を切り替えれば同じプロセスで両方の経路を試せる。
  if (isForcedNoDrawtext(process.env[STUB_FORCE_NO_DRAWTEXT_ENV])) return Promise.resolve(false)
  cachedSupport ??= probeDrawtext(options)
  return cachedSupport
}

/** テストで判定をやり直すためのリセット。プロダクションコードから呼ばないこと。 */
export const resetDrawtextSupportCache = (): void => {
  cachedSupport = null
}
