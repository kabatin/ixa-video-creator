import type { RenderPreset, TimelineDocument } from '@ixa/domain'
import { PRESET_SETTINGS } from './presets.js'

/** ffmpeg のフィルタ式に指数表記を渡さない。秒は固定小数で書く。 */
const sec = (value: number): string => value.toFixed(6)

const ms = (value: number): string => String(Math.round(value * 1000))

const CODEC_ARGS: Readonly<Record<'h264' | 'h265', readonly string[]>> = {
  // hvc1 タグを付けないと QuickTime / Safari が H.265 の mp4 を再生できない。
  h264: ['-c:v', 'libx264'],
  h265: ['-c:v', 'libx265', '-tag:v', 'hvc1'],
}

/**
 * 素材をキャンバスへ収めるフィルタ。
 * **アスペクト比を保って縮小し（decrease）、余白を黒帯で埋める（pad）**。
 * 引き伸ばしも切り落としもしない。`presets.ts` の `letterboxFit` と同じ方針。
 */
const fitFilter = (width: number, height: number): string =>
  [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
  ].join(',')

/**
 * VIDEO1 を黒キャンバスの上に時刻指定で重ねる。
 *
 * 単純な concat ではなく overlay を使うのは、
 * - Shot が 0 秒から始まらない / Shot 間にすき間がある場合でも位置がずれない
 * - タイムライン全体の尺（`durationSec`）を黒キャンバスが保証する
 * ため。concat だと「Shot の合計尺」になってしまい `durationSec` と一致しない。
 */
const videoFilters = (
  doc: TimelineDocument,
  width: number,
  height: number,
): { readonly filters: readonly string[]; readonly label: string } => {
  const filters: string[] = []
  let current = '0:v'

  doc.video1.forEach((shot, index) => {
    const input = index + 1
    const start = shot.startSec
    const end = shot.startSec + shot.durationSec
    // 尺に合わせた速度（ADR-0026）。尺 × 速度だけ素材を使い、時間を 1/速度 に伸び縮みさせる。
    // Remotion の合成（OffthreadVideo の playbackRate）と同じ結果にする。
    const rate = shot.playbackRate ?? 1
    const timing =
      rate === 1
        ? `setpts=PTS-STARTPTS+${sec(start)}/TB`
        : `setpts=(PTS-STARTPTS)/${sec(rate)}+${sec(start)}/TB`

    filters.push(
      `[${input}:v]trim=start=${sec(shot.inSec)}:duration=${sec(shot.durationSec * rate)},` +
        `${timing},${fitFilter(width, height)},fps=${doc.fps}[v${index}]`,
    )
    filters.push(
      `[${current}][v${index}]overlay=eof_action=pass:enable='between(t,${sec(start)},${sec(end)})'[o${index}]`,
    )
    current = `o${index}`
  })

  return { filters, label: current }
}

/** `audio` を adelay で並べて amix する。normalize=0 で音量を勝手に下げさせない。 */
const audioFilters = (
  doc: TimelineDocument,
  firstAudioInput: number,
): { readonly filters: readonly string[]; readonly label: string | null } => {
  if (doc.audio.length === 0) return { filters: [], label: null }

  const filters = doc.audio.map((track, index) => {
    const input = firstAudioInput + index
    const delay = ms(track.startSec)
    return (
      `[${input}:a]atrim=start=0:duration=${sec(track.durationSec)},asetpts=PTS-STARTPTS,` +
      `volume=${track.volume.toFixed(4)},adelay=${delay}:all=1[a${index}]`
    )
  })

  if (doc.audio.length === 1) return { filters, label: 'a0' }

  const inputs = doc.audio.map((_, index) => `[a${index}]`).join('')
  return {
    filters: [...filters, `${inputs}amix=inputs=${doc.audio.length}:normalize=0[amix]`],
    label: 'amix',
  }
}

/**
 * 退避用レンダラの ffmpeg 引数を組み立てる純粋関数（子プロセスを起動しない）。
 *
 * **`clips` は 1 つも描かれず、`transitions` も cut 以外は無視される。**
 * `media` / `text` / `motion_graphics` / `unresolved` のいずれも同じく捨てる。
 * これは capabilities で表明している通りの縮退であり、バグではない
 * （内訳は `ffmpeg-renderer.ts` の `createFfmpegRenderer` のコメント）。
 */
export const buildFfmpegArgs = (
  doc: TimelineDocument,
  preset: RenderPreset,
  outputPath: string,
): readonly string[] => {
  const settings = PRESET_SETTINGS[preset]
  const duration = sec(doc.durationSec)

  const baseInput = [
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${settings.width}x${settings.height}:r=${doc.fps}:d=${duration}`,
  ]
  const shotInputs = doc.video1.flatMap((shot) => ['-i', shot.mediaUrl])
  const audioInputs = doc.audio.flatMap((track) => ['-i', track.mediaUrl])

  const video = videoFilters(doc, settings.width, settings.height)
  const audio = audioFilters(doc, 1 + doc.video1.length)
  const filters = [...video.filters, ...audio.filters]

  const filterArgs = filters.length === 0 ? [] : ['-filter_complex', filters.join(';')]
  const videoMap = filters.length === 0 ? ['-map', '0:v'] : ['-map', `[${video.label}]`]
  const audioMap = audio.label === null ? ['-an'] : ['-map', `[${audio.label}]`, '-c:a', 'aac', '-b:a', settings.audioBitrate]

  return [
    '-y',
    ...baseInput,
    ...shotInputs,
    ...audioInputs,
    ...filterArgs,
    ...videoMap,
    ...audioMap,
    ...CODEC_ARGS[settings.codec],
    '-crf',
    String(settings.crf),
    '-preset',
    'medium',
    '-pix_fmt',
    settings.pixelFormat,
    '-r',
    String(doc.fps),
    // 尺は黒キャンバスではなく -t で確定させる。素材が長短どちらでも durationSec に揃う。
    '-t',
    duration,
    '-movflags',
    '+faststart',
    outputPath,
  ]
}
