import { MAX_SPEECH_SEGMENTS, type SpeechSegment } from '@ixa/domain'
import { MAX_STDERR_CHARS, runFfmpeg, type RunOptions } from './ffmpeg-runner.js'

/**
 * 素材の音から、話している区間を拾う（ADR-0061）。ffmpeg の `silencedetect` で無音を見つけ、その裏返しを区間にする。
 *
 * **簡易な拾い方**で、周りの物音が大きい Take では外れやすい。外れたとき（区間の数が行の数と合わない）は、
 * セリフの字幕は Shot の尺を文字数で割り振る側に戻る（`@ixa/domain` の `dialogueTelopClips`）。
 */

/** これより小さい音は無音とみなす（H3 の声は -20 dBFS 前後。環境音を声と取り違えにくい高さ）。 */
export const SPEECH_SILENCE_NOISE_DB = -35
/** これより短い無音は、行の切れ目とみなさない（息継ぎ・読点の間）。 */
export const SPEECH_MIN_SILENCE_SEC = 0.25
/** これより短い音は、声とみなさない（物音・クリック）。 */
export const SPEECH_MIN_SEGMENT_SEC = 0.15

const SILENCE_START = /silence_start:\s*(-?[\d.]+)/
const SILENCE_END = /silence_end:\s*(-?[\d.]+)/

type Silence = { readonly startSec: number; readonly endSec: number }

/** stderr の行から無音の区間を読む。閉じていない最後の無音は尺で閉じる。 */
const silencesOf = (stderr: string, durationSec: number): readonly Silence[] => {
  const events = stderr.split('\n').flatMap((line): readonly { readonly kind: 'start' | 'end'; readonly sec: number }[] => {
    const start = SILENCE_START.exec(line)?.[1]
    const end = SILENCE_END.exec(line)?.[1]
    if (start !== undefined) return [{ kind: 'start', sec: Math.max(0, Number.parseFloat(start)) }]
    if (end !== undefined) return [{ kind: 'end', sec: Math.min(durationSec, Number.parseFloat(end)) }]
    return []
  })
  const folded = events.reduce<{ readonly done: readonly Silence[]; readonly open: number | null }>(
    (acc, event) => {
      if (event.kind === 'start') return { done: acc.done, open: event.sec }
      if (acc.open === null) return acc
      return { done: [...acc.done, { startSec: acc.open, endSec: event.sec }], open: null }
    },
    { done: [], open: null },
  )
  // 閉じていない無音（最後まで静か）は尺で閉じる。
  return folded.open === null ? folded.done : [...folded.done, { startSec: folded.open, endSec: durationSec }]
}

const round3 = (sec: number): number => Math.round(sec * 1000) / 1000

/**
 * silencedetect の出力（stderr）から、音のある区間を作る純粋関数。尺（秒）の中の、無音の間すべてが区間になる。
 * 尺が分からない（0 以下）なら区間を作らない。
 */
export const parseSilenceDetect = (stderr: string, durationSec: number): readonly SpeechSegment[] => {
  if (!(durationSec > 0)) return []
  const silences = [...silencesOf(stderr, durationSec)].sort((a, b) => a.startSec - b.startSec)
  const bounds = silences.reduce<{ readonly segments: readonly SpeechSegment[]; readonly cursor: number }>(
    (acc, silence) => ({
      segments: [...acc.segments, { startSec: acc.cursor, endSec: silence.startSec }],
      cursor: Math.max(acc.cursor, silence.endSec),
    }),
    { segments: [], cursor: 0 },
  )
  return [...bounds.segments, { startSec: bounds.cursor, endSec: durationSec }]
    .map((segment) => ({ startSec: round3(segment.startSec), endSec: round3(segment.endSec) }))
    .filter((segment) => segment.endSec - segment.startSec >= SPEECH_MIN_SEGMENT_SEC)
    .slice(0, MAX_SPEECH_SEGMENTS)
}

/**
 * stderr から区間を作る。**頭が切れた stderr（`truncated`）は「分からない」（null）**にする。
 * 頭の `silence_start: 0` が消えていると、最初の無音を 0 秒からの声と取り違えて、無い区間を作ってしまう。
 */
export const speechSegmentsFromStderr = (
  stderr: string,
  durationSec: number,
  options: { readonly truncated: boolean },
): readonly SpeechSegment[] | null => (options.truncated ? null : parseSilenceDetect(stderr, durationSec))

/**
 * 実 ffmpeg で、素材の最初の音のトラックの話している区間を拾う。音のトラックが無い素材では ffmpeg が失敗する（呼ぶ側が見分ける）。
 * 出力が長すぎて頭が切れたら null（「測っていない」と同じ扱い。字幕は割り振りに戻る）。
 */
export const detectSpeechSegments = async (
  filePath: string,
  durationSec: number,
  options?: RunOptions,
): Promise<readonly SpeechSegment[] | null> => {
  const { stderr } = await runFfmpeg(
    [
      '-hide_banner', '-nostats', '-i', filePath, '-map', '0:a:0', '-vn',
      '-af', `silencedetect=noise=${String(SPEECH_SILENCE_NOISE_DB)}dB:d=${String(SPEECH_MIN_SILENCE_SEC)}`,
      '-f', 'null', '-',
    ],
    options,
  )
  return speechSegmentsFromStderr(stderr, durationSec, { truncated: stderr.length >= MAX_STDERR_CHARS })
}
