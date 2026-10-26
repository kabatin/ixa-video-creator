import {
  DUB_WARN_TEMPO,
  MAX_DUB_LEVEL_DB,
  MIN_DUB_LEVEL_DB,
  DialogueDub,
  type DialogueLine,
  type DubJob,
  type DubLineMode,
  type DubParams,
} from '@ixa/domain'
import { formatClock, formatDuration } from '@/lib/format-time'
import { parseClockInput, parseDurationInput } from '@/lib/time-input'

/**
 * 声の差し替え（ADR-0062）の画面の言葉と、行ごとの「差し替えの指定」の欄の読み書き。**React を含まない。**
 */

const MODE_LABELS: Readonly<Record<DubLineMode, string>> = {
  lip: '口に合わせた',
  place_at: '置く時刻から',
  fit: '長さに収めた',
  cut: '長さで切った',
  keep_original: '元の声のまま',
}

export type DubResultRow = {
  readonly lineNo: number
  readonly text: string
  readonly mode: string
  /** 一致率（例 92%）。口に合わせていない行は「—」。 */
  readonly agreement: string
  /** 伸縮の幅（例 1.05〜1.32 倍）。 */
  readonly tempo: string
  /** 早口に聞こえる（1.4 倍を超えた）。黄色で出す。 */
  readonly fast: boolean
  readonly warnings: readonly string[]
}

const times = (value: number): string => value.toFixed(2)

const tempoLabel = (min: number, max: number): string =>
  Math.abs(max - min) < 0.005 ? `${times(min)} 倍` : `${times(min)}〜${times(max)} 倍`

/** 結果の表の行（行の順）。セリフが記録の後に消された行は、本文を空にして残す。 */
export const dubResultRows = (record: DubParams, dialogue: readonly Pick<DialogueLine, 'text'>[]): readonly DubResultRow[] =>
  [...record.lines]
    .sort((a, b) => a.lineIndex - b.lineIndex)
    .map((line) => ({
      lineNo: line.lineIndex + 1,
      text: dialogue[line.lineIndex]?.text ?? '',
      mode: MODE_LABELS[line.mode],
      agreement: line.agreement === null ? '—' : `${String(Math.round(line.agreement * 100))}%`,
      tempo: tempoLabel(line.tempoMin, line.tempoMax),
      fast: line.tempoMax > DUB_WARN_TEMPO + 1e-9,
      warnings: line.warnings.map((warning) => warning.message),
    }))

const ACTIVE: readonly DubJob['status'][] = ['queued', 'running']

export const isDubActive = (job: Pick<DubJob, 'status'> | null): boolean => job !== null && ACTIVE.includes(job.status)

export const dubProgressLabel = (job: Pick<DubJob, 'status'>): string =>
  job.status === 'queued' ? '順番を待っています…' : job.status === 'running' ? '声を差し替えています…' : ''

// --- 差し替えの指定（行ごと） ---

export type DubField = 'style' | 'placeAtSec' | 'fitSec' | 'cutSec' | 'levelDb' | 'startSec' | 'endSec'

/** 欄の見出し（画面とエラーの文に使う）。 */
export const DUB_FIELD_LABELS: Readonly<Record<DubField, string>> = {
  style: '読み方の指示',
  placeAtSec: '置く時刻',
  fitSec: '収める長さ',
  cutSec: '切る長さ',
  levelDb: '距離（dB）',
  startSec: '手の区間の始め',
  endSec: '手の区間の終わり',
}

const POSITION_FIELDS: readonly DubField[] = ['placeAtSec', 'startSec', 'endSec']
const LENGTH_FIELDS: readonly DubField[] = ['fitSec', 'cutSec']

/** 欄に出す文字（時刻は `0:01.20`、長さは `1.20s`、距離は数）。無ければ空。 */
export const dubFieldText = (dub: DialogueDub | undefined, field: DubField): string => {
  const value = dub?.[field]
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (POSITION_FIELDS.includes(field)) return formatClock(value)
  if (LENGTH_FIELDS.includes(field)) return formatDuration(value)
  return String(value)
}

const parseLevel = (raw: string): number | null => {
  const text = raw.trim().replace(/db$/iu, '').trim()
  return /^[-+]?\d+(?:\.\d+)?$/u.test(text) ? Number(text) : null
}

/** キャラクターの「距離の既定（dB）」の欄。空は 0。範囲（-40〜12）の外・読めない値は null。 */
export const parseDubLevelInput = (raw: string): number | null => {
  if (raw.trim() === '') return 0
  const value = parseLevel(raw)
  return value === null || value < MIN_DUB_LEVEL_DB || value > MAX_DUB_LEVEL_DB ? null : value
}

export const DUB_LEVEL_RANGE_MESSAGE = `距離は ${String(MIN_DUB_LEVEL_DB)}〜${String(MAX_DUB_LEVEL_DB)} dB で入れてください`

/** 欄の文字を値にする。空は「指定なし」（undefined）。読めなければ null。 */
const parseField = (field: DubField, raw: string): string | number | undefined | null => {
  const text = raw.trim()
  if (text === '') return undefined
  if (field === 'style') return text
  if (field === 'levelDb') return parseLevel(text)
  if (POSITION_FIELDS.includes(field)) return parseClockInput(text)
  return parseDurationInput(text)
}

const INPUT_HINTS: Readonly<Record<DubField, string>> = {
  style: '',
  placeAtSec: '0:01.20 のように入れてください',
  fitSec: '1.20s のように入れてください',
  cutSec: '1.20s のように入れてください',
  levelDb: '-9.5 のように数で入れてください',
  startSec: '0:01.20 のように入れてください',
  endSec: '0:01.20 のように入れてください',
}

/** 外したチェック（false）は「指定なし」と同じ。`snap: false` は意味があるので残す。 */
const OFF_MEANS_UNSET: readonly string[] = ['keepOriginal', 'added']

/** 指定なし（空の値）を落とす。何も残らなければ undefined（行に `dub` の鍵を持たせない）。 */
const compact = (dub: Record<string, unknown>): Record<string, unknown> | undefined => {
  const entries = Object.entries(dub).filter(
    ([key, value]) => value !== undefined && !(value === false && OFF_MEANS_UNSET.includes(key)),
  )
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

export type DubEdit = { readonly ok: true; readonly dub: DialogueDub | undefined } | { readonly ok: false; readonly message: string }

/** 範囲の外の値の文（zod の英語の既定文を画面に出さない）。 */
const rangeMessage = (path: string): string => {
  if (path === 'levelDb') return DUB_LEVEL_RANGE_MESSAGE
  if (path === 'style') return '読み方の指示は 200 字までにしてください'
  if (path === 'fitSec' || path === 'cutSec') return `${DUB_FIELD_LABELS[path]}は 0.10s 以上・2:00 までにしてください`
  const label = (DUB_FIELD_LABELS as Readonly<Record<string, string>>)[path]
  return label === undefined ? '差し替えの指定が正しくありません' : `${label}は 2:00 までにしてください`
}

/** 指定を確かめる（domain の `DialogueDub` と同じ規則。食い違いの文は domain の日本語をそのまま出す）。 */
const checked = (next: Record<string, unknown> | undefined): DubEdit => {
  if (next === undefined) return { ok: true, dub: undefined }
  const parsed = DialogueDub.safeParse(next)
  if (parsed.success) return { ok: true, dub: parsed.data }
  const issue = parsed.error.issues[0]
  const path = String(issue?.path[0] ?? '')
  return { ok: false, message: issue?.code === 'custom' ? issue.message : rangeMessage(path) }
}

/** 1 つの欄を書き換えた指定。読めない値・規則に合わない値は保存しない（理由を返す）。 */
export const editDubField = (dub: DialogueDub | undefined, field: DubField, raw: string): DubEdit => {
  const value = parseField(field, raw)
  if (value === null) return { ok: false, message: `${DUB_FIELD_LABELS[field]}: ${INPUT_HINTS[field]}` }
  return checked(compact({ ...dub, [field]: value }))
}

/** チェック・選択の欄（元の声のまま・足す行・音量を合わせる行）。 */
export const editDubFlag = (
  dub: DialogueDub | undefined,
  patch: { readonly keepOriginal?: boolean; readonly added?: boolean; readonly levelLikeIndex?: number | undefined },
): DubEdit => {
  const merged: Record<string, unknown> = { ...dub, ...patch }
  // 足す行をやめたら、足す行にだけ使う「音量を合わせる行」も外す。
  const next = merged['added'] === true ? merged : { ...merged, levelLikeIndex: undefined }
  return checked(compact(next))
}

/** 行の区間の案を入れた指定（2 人のセリフが 1 つの区間にまとまって止まったとき）。 */
export const withSuggestedSpan = (
  dub: DialogueDub | undefined,
  span: { readonly startSec: number; readonly endSec: number },
): DubEdit => checked(compact({ ...dub, startSec: span.startSec, endSec: span.endSec }))

/** 開いたときの見出しに添える「指定あり」。 */
export const hasDubSpec = (dub: DialogueDub | undefined): boolean => dub !== undefined && Object.keys(dub).length > 0

export const spanLabel = (span: { readonly startSec: number; readonly endSec: number }): string =>
  `${formatClock(span.startSec)}〜${formatClock(span.endSec)}`
