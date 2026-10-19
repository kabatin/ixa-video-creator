import {
  MUSIC_COUNT_MAX,
  MUSIC_LYRICS_MAX_LENGTH,
  MUSIC_PROMPT_MAX_LENGTH,
  decideMusicTool,
  isMusicJobFinished,
  musicToolLimits,
  type AiToolId,
  type MusicToolLimits,
  type ProjectEvent,
} from '@ixa/domain'
import { formatDuration, formatLongDuration } from '@/lib/format-time'
import type { MusicGenerateBody, WireMusicJob } from '@/lib/music-job-api'

/**
 * 「曲を作る」（ADR-0048）の中身。**React を含まない。**
 * 上限は domain の定数をそのまま使い、ここで数を書き写さない（API の検証と同じ値）。
 */

/** 欄の値。数の欄は打ちかけ（空・`1.`）を持てるよう文字で持つ。 */
export type MusicForm = {
  readonly prompt: string
  readonly lyrics: string
  readonly durationSec: string
  readonly instrumental: boolean
  readonly count: string
}

export const DEFAULT_MUSIC_DURATION_SEC = 60

export const INITIAL_MUSIC_FORM: MusicForm = {
  prompt: '',
  lyrics: '',
  durationSec: String(DEFAULT_MUSIC_DURATION_SEC),
  instrumental: false,
  count: '1',
}

export type MusicFormField = 'prompt' | 'lyrics' | 'durationSec' | 'count'
export type MusicFormErrors = Readonly<Partial<Record<MusicFormField, string>>>

export type MusicFormResult =
  | { readonly ok: true; readonly body: MusicGenerateBody }
  | { readonly ok: false; readonly errors: MusicFormErrors }

/** 数でなければ null。空欄は 0 になり、範囲の外として止まる。 */
const toNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value : null
}

const promptError = (prompt: string): string | undefined => {
  if (prompt === '') return '曲調を入れてください（例: j-pop, upbeat, female vocal）'
  if (prompt.length > MUSIC_PROMPT_MAX_LENGTH) return `曲調は ${String(MUSIC_PROMPT_MAX_LENGTH)} 字までです`
  return undefined
}

const lyricsError = (lyrics: string): string | undefined =>
  lyrics.length > MUSIC_LYRICS_MAX_LENGTH ? `歌詞は ${String(MUSIC_LYRICS_MAX_LENGTH)} 字までです` : undefined

/** 選んでいる曲の AI が分からない間は、歌える AI（ACE-Step）の範囲で確かめる。API がもう一度確かめる。 */
export const DEFAULT_MUSIC_LIMITS: MusicToolLimits = musicToolLimits('ace_step')

/** 長さの範囲の言い方（`10〜240 秒`）。 */
export const durationRangeText = (limits: MusicToolLimits): string =>
  `${String(limits.durationSec.min)}〜${String(limits.durationSec.max)} 秒`

const durationError = (value: number | null, limits: MusicToolLimits): string | undefined =>
  value === null || value < limits.durationSec.min || value > limits.durationSec.max
    ? `長さは ${durationRangeText(limits)}で入れてください`
    : undefined

const countError = (value: number | null): string | undefined =>
  value === null || !Number.isInteger(value) || value < 1 || value > MUSIC_COUNT_MAX
    ? `何曲作るかは 1〜${String(MUSIC_COUNT_MAX)} で選んでください`
    : undefined

/**
 * どの AI で作られる見込みか。選んでいる AI が歌なしだけで歌ありにしたら、歌える AI（ACE-Step）に回る
 * （振り分けは domain の `decideMusicTool`。使えるかは API が決めるので、画面では使える前提で先に見せる）。
 */
export const plannedMusicTool = (chosen: AiToolId, instrumental: boolean): AiToolId => {
  const shortest = musicToolLimits(chosen).durationSec.min
  const decision = decideMusicTool(chosen, { lyrics: '', instrumental, durationSec: shortest }, () => true)
  return decision.state === 'ready' ? decision.tool : chosen
}

/**
 * 欄の値を確かめて、頼む本文にする。**歌なしなら歌詞は送らない**（欄に残っていても使わない）。
 * 長さの範囲は作る見込みの AI のもの（`limits`）。
 */
export const validateMusicForm = (form: MusicForm, limits: MusicToolLimits = DEFAULT_MUSIC_LIMITS): MusicFormResult => {
  const prompt = form.prompt.trim()
  const { instrumental } = form
  const lyrics = instrumental ? '' : form.lyrics
  const durationSec = toNumber(form.durationSec)
  const count = toNumber(form.count)
  const found: ReadonlyArray<readonly [MusicFormField, string | undefined]> = [
    ['prompt', promptError(prompt)],
    ['lyrics', lyricsError(lyrics)],
    ['durationSec', durationError(durationSec, limits)],
    ['count', countError(count)],
  ]
  const errors: MusicFormErrors = Object.fromEntries(
    found.filter((entry): entry is readonly [MusicFormField, string] => entry[1] !== undefined),
  )
  if (Object.keys(errors).length > 0 || durationSec === null || count === null) {
    return { ok: false, errors }
  }
  return { ok: true, body: { prompt, lyrics, durationSec, instrumental, count } }
}

/** まだ終わっていないジョブ（待っている・作っている）。 */
export const activeMusicJobs = (jobs: readonly WireMusicJob[]): readonly WireMusicJob[] =>
  jobs.filter((job) => !isMusicJobFinished(job.status))

/** 長さの言い方。分をまたぐ長さは時計形式も添える（`format-time` の使い分け）。 */
const lengthOf = (sec: number): string => (sec >= 60 ? formatLongDuration(sec) : formatDuration(sec))

/** 進み具合の 1 行（`曲を作っています…（2 曲・1:00.00（60.00s））`）。 */
export const describeMusicJob = (job: WireMusicJob): string => {
  const what = `${String(job.count)} 曲・${lengthOf(job.durationSec)}`
  return job.status === 'queued' ? `順番を待っています…（${what}）` : `曲を作っています…（${what}）`
}

type MusicJobEvent = Extract<ProjectEvent, { type: 'music_job.status' }>

/**
 * 楽曲を足した知らせか（楽曲の一覧を読み直すか）。できたときに加えて、
 * **止めたが間に合わず足していた**とき（worker が足した楽曲の ID を載せて止めた知らせを流す）も読み直す。
 */
export const musicJobAddedTracks = (event: MusicJobEvent): boolean => event.musicTrackIds.length > 0

/**
 * 曲のジョブの出来事から、上の知らせに出す文。できた・作れなかった・止めたが楽曲を足していたときだけ。
 * ふつうに止めたとき・途中の出来事は null（止めたのは本人なので知らせない）。
 * 理由を捨てると、利用者から見て「遅い」と「失敗した」が区別できない。
 */
export const musicJobNotice = (event: MusicJobEvent): string | null => {
  if (event.status === 'succeeded') {
    return `曲ができました。楽曲に ${String(event.musicTrackIds.length)} 曲足しました（解析を始めています）。`
  }
  if (event.status === 'failed') return `曲を作れませんでした: ${event.error ?? '理由が届きませんでした。'}`
  if (event.status === 'cancelled' && musicJobAddedTracks(event)) {
    return `曲を作るのを止めましたが、間に合わず楽曲に ${String(event.musicTrackIds.length)} 曲足しました。`
  }
  return null
}
