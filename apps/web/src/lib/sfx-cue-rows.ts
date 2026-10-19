import { SFX_DURATION_MIN_SEC, SFX_DEFAULT_VOLUME, SfxCue, type SfxCueInput } from '@ixa/domain'
import { formatClock } from '@/lib/format-time'

/**
 * 「効果音を作る」窓の行（ADR-0054）。**純粋。** 案（動きの分析・エフェクト）から行を作り、
 * 人が直した文字の欄を、API に送るきっかけ（`SfxCue`）へ戻す。範囲の正は domain の `SfxCue`。
 */

export type SfxCueRow = {
  readonly id: string
  readonly checked: boolean
  /** 時刻（タイムラインの位置。`0:24.72`）。 */
  readonly start: string
  /** 長さ（秒の数字）。 */
  readonly duration: string
  /** 効果音の AI への指示（英語）。 */
  readonly prompt: string
  readonly volume: string
  /** なぜこの行か（案の理由。手で足した行は空）。 */
  readonly reason: string
}

export type SfxSuggestionLike = {
  readonly kind: string
  readonly reason: string
  readonly cue: { readonly startSec: number; readonly durationSec: number; readonly prompt: string; readonly volume: number }
}

/** 下に敷く音。案に出しても最初はチェックを外す（足すかは人が決める）。 */
const UNCHECKED_KINDS: ReadonlySet<string> = new Set(['motion_ambient'])

let rowSeq = 0
const nextRowId = (): string => {
  rowSeq += 1
  return `cue-row-${String(rowSeq)}`
}

export const cueRowsFromSuggestions = (suggestions: readonly SfxSuggestionLike[]): readonly SfxCueRow[] =>
  suggestions.map((s) => ({
    id: nextRowId(),
    checked: !UNCHECKED_KINDS.has(s.kind),
    start: formatClock(s.cue.startSec),
    duration: s.cue.durationSec.toFixed(2),
    prompt: s.cue.prompt,
    volume: String(s.cue.volume),
    reason: s.reason,
  }))

export const blankCueRow = (atSec: number): SfxCueRow => ({
  id: nextRowId(),
  checked: true,
  start: formatClock(atSec),
  duration: SFX_DURATION_MIN_SEC.toFixed(2),
  prompt: '',
  volume: String(SFX_DEFAULT_VOLUME),
  reason: '',
})

/** `0:24.72`・`1:02.5`・`24.72` を秒にする。読めなければ null。 */
export const parseClock = (text: string): number | null => {
  const trimmed = text.trim()
  const clock = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(trimmed)
  if (clock !== null) {
    const seconds = Number(clock[2])
    return seconds < 60 ? Number(clock[1]) * 60 + seconds : null
  }
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : null
}

export type CueRowsResult =
  | { readonly ok: true; readonly cues: readonly SfxCueInput[] }
  | { readonly ok: false; readonly message: string; readonly errors: Readonly<Record<string, string>> }

const NOTHING_CHECKED = '作る行にチェックを付けてください。'
const UNREADABLE_START = '時刻は 0:24.72 の形で入れてください。'

const rowToCue = (row: SfxCueRow): { readonly cue: SfxCueInput } | { readonly error: string } => {
  const startSec = parseClock(row.start)
  if (startSec === null) return { error: UNREADABLE_START }
  const parsed = SfxCue.safeParse({
    startSec,
    durationSec: Number(row.duration),
    prompt: row.prompt,
    volume: Number(row.volume),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '入力を確かめてください。' }
  return { cue: parsed.data }
}

/** チェックした行をきっかけにする。どれか 1 行でもおかしければ、その行に理由を付けて断る。 */
export const validateCueRows = (rows: readonly SfxCueRow[]): CueRowsResult => {
  const checked = rows.filter((row) => row.checked)
  if (checked.length === 0) return { ok: false, message: NOTHING_CHECKED, errors: {} }
  const results = checked.map((row) => ({ row, result: rowToCue(row) }))
  const errors = Object.fromEntries(
    results.flatMap(({ row, result }) => ('error' in result ? [[row.id, result.error] as const] : [])),
  )
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: '直す必要のある行があります。', errors }
  }
  return { ok: true, cues: results.flatMap(({ result }) => ('cue' in result ? [result.cue] : [])) }
}
