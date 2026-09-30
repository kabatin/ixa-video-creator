import { MediaProbe } from '@ixa/domain'
import { z } from 'zod'
import { FfmpegError, runFfprobe, type RunOptions } from './ffmpeg-runner.js'
import { parseFrameRate } from './frame-rate.js'

/**
 * ffprobe の JSON 出力スキーマ。
 * 外部プロセスの出力は信用できないため、必ず zod を通してから MediaProbe へ変換する（CLAUDE.md 規約 4）。
 * ffprobe はバージョンによって未知のフィールドを増やすので passthrough で受ける。
 */
const FfprobeStream = z
  .object({
    codec_type: z.string().optional(),
    codec_name: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    r_frame_rate: z.string().optional(),
    avg_frame_rate: z.string().optional(),
    duration: z.string().optional(),
  })
  .passthrough()

const FfprobeOutput = z
  .object({
    streams: z.array(FfprobeStream).default([]),
    format: z.object({ duration: z.string().optional() }).passthrough().optional(),
  })
  .passthrough()

type FfprobeStream = z.infer<typeof FfprobeStream>

// -v は quiet ではなく error にする。quiet だと存在しないファイル等で stderr が空になり、
// FfmpegError に exit code しか残らず原因が分からなくなるため。
const PROBE_ARGS = [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
] as const

/** ffprobe は不明値を "N/A" で返すことがあるため、数値として妥当なときだけ採用する。 */
const parseDuration = (value: string | undefined): number | null => {
  if (value === undefined) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const parsePositiveInt = (value: number | undefined): number | null =>
  value !== undefined && Number.isInteger(value) && value > 0 ? value : null

const firstStreamOfType = (streams: readonly FfprobeStream[], type: string): FfprobeStream | null =>
  streams.find((stream) => stream.codec_type === type) ?? null

/** ffprobe の JSON 文字列から MediaProbe を組み立てる純粋関数。子プロセスを起動しない。 */
export const toMediaProbe = (rawJson: string): MediaProbe => {
  const parsedJson: unknown = JSON.parse(rawJson)
  const output = FfprobeOutput.parse(parsedJson)

  const videoStream = firstStreamOfType(output.streams, 'video')
  const audioStream = firstStreamOfType(output.streams, 'audio')

  const durationSec =
    parseDuration(output.format?.duration) ??
    parseDuration(videoStream?.duration) ??
    parseDuration(audioStream?.duration)

  const fps =
    videoStream === null
      ? null
      : (parseFrameRate(videoStream.r_frame_rate) ?? parseFrameRate(videoStream.avg_frame_rate))

  return MediaProbe.parse({
    durationSec,
    // durationSec とは別に持つ。コンテナの尺は音声が映像より長いとそちらに引っ張られる。
    videoDurationSec: parseDuration(videoStream?.duration),
    width: parsePositiveInt(videoStream?.width),
    height: parsePositiveInt(videoStream?.height),
    fps,
    hasAudio: audioStream !== null,
    codec: videoStream?.codec_name ?? audioStream?.codec_name ?? null,
  })
}

/**
 * ffprobe でメディアのメタデータを取得する。
 * 動画ストリームが無ければ width / height / fps は null になる。
 * ファイルが存在しない・壊れている場合は FfmpegError を throw する。
 */
export const probeMedia = async (filePath: string, options?: RunOptions): Promise<MediaProbe> => {
  const { stdout } = await runFfprobe([...PROBE_ARGS, filePath], options)

  try {
    return toMediaProbe(stdout)
  } catch (error) {
    throw new FfmpegError(
      'ffprobe の出力を解釈できませんでした',
      `ffprobe ${[...PROBE_ARGS, filePath].join(' ')}`,
      0,
      stdout,
      { cause: error },
    )
  }
}
