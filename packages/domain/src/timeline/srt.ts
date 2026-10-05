import { parseTextClipParams } from './text-template.js'
import type { RenderableClip } from './timeline.js'

/**
 * 字幕ファイル（SRT）。テロップを書き出しの横に置き、YouTube などの字幕に使う（ADR-0039）。
 *
 * 形: 番号 / `時:分:秒,ミリ秒 --> 時:分:秒,ミリ秒` / 字 / 空行。字の中の空行は区切りと読まれるので詰める。
 */

export type SubtitleCue = {
  readonly startSec: number
  readonly endSec: number
  readonly text: string
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

const timestamp = (seconds: number): string => {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const secs = Math.floor((totalMs % 60_000) / 1000)
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(totalMs % 1000, 3)}`
}

const cleanText = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n')

export const toSrt = (cues: readonly SubtitleCue[]): string =>
  [...cues]
    .map((cue) => ({ ...cue, text: cleanText(cue.text) }))
    .filter((cue) => cue.text !== '')
    .sort((a, b) => a.startSec - b.startSec)
    .map((cue, index) => `${index + 1}\n${timestamp(cue.startSec)} --> ${timestamp(cue.endSec)}\n${cue.text}\n`)
    .join('\n')

/**
 * 書き出したタイムライン（スナップショット）のテロップを字幕にする。手で置いた・歌詞・ナレーションのどれも入れる
 * （動画に出ている字と同じにする）。テロップ以外と、読めないテロップは入れない。
 */
export const subtitleCuesOf = (clips: readonly RenderableClip[]): readonly SubtitleCue[] =>
  clips.flatMap((clip) => {
    if (clip.content.type !== 'text') return []
    const params = parseTextClipParams(clip.content.params)
    return params === null ? [] : [{ startSec: clip.startSec, endSec: clip.startSec + clip.durationSec, text: params.text }]
  })
