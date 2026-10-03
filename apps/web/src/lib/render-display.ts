import type { RenderJob, RenderPreset } from '@ixa/domain'
import { RENDER_PRESET_LABELS, RenderPreset as RenderPresetSchema } from '@ixa/domain'

/**
 * 書き出し画面の表示用ラベルと判定。React を含まない純粋関数だけを置く。
 *
 * **「まだ始まっていない」「進捗の報告が無い」「失敗した」を混ぜない。**
 * どれも「進捗が表示されない」という同じ見た目になるが、利用者が次に取る行動は
 * まったく違う（待つ / 待つ・ただし詰まっているかもしれない / 直して出し直す）。
 * 空や 0 を「順調」に畳むと、止まっているものを動いていると信じさせる（lessons L-015）。
 */

export type RenderJobStatus = RenderJob['status']

/** 進捗・状態の表示に必要な列だけ。一覧と詳細で同じ関数を使うため最小に絞る。 */
export type RenderJobLike = {
  readonly status: RenderJobStatus
  readonly progress: number
  readonly error: string | null
  readonly outputAssetId: string | null
  readonly createdAt: Date
  readonly finishedAt: Date | null
}

// --- プリセット ---

export type RenderPresetInfo = {
  readonly label: string
  readonly hint: string
}

/**
 * プリセットの説明。**解像度やビットレートの数値は書かない。**
 * 正は `packages/render` の `PRESET_SETTINGS` で、ここに数値を写すと必ずズレる
 * （lessons L-016）。名前が持っている情報（720p / 4K / 縦）だけを言い換える。
 */
/** 名前は domain の `RENDER_PRESET_LABELS` が正（フォルダに置くファイル名と同じにする。ADR-0036）。 */
const PRESET_INFO: Readonly<Record<RenderPreset, RenderPresetInfo>> = {
  preview_720p: {
    label: RENDER_PRESET_LABELS.preview_720p,
    hint: '確認用。いちばん速く終わり、ファイルも小さい',
  },
  master_1080p: {
    label: RENDER_PRESET_LABELS.master_1080p,
    hint: '納品用。まずはこれを選ぶ',
  },
  master_4k: {
    label: RENDER_PRESET_LABELS.master_4k,
    hint: '納品用。いちばん時間がかかる',
  },
  social_vertical: {
    label: RENDER_PRESET_LABELS.social_vertical,
    hint: '縦長の画面向け。横長の素材は上下に黒帯が入る',
  },
}

export type RenderPresetOption = { readonly value: RenderPreset } & RenderPresetInfo

/** 選択肢はドメインの enum から作る。プリセットが増えたら型で気付ける。 */
export const RENDER_PRESET_OPTIONS: readonly RenderPresetOption[] = RenderPresetSchema.options.map(
  (value) => ({ value, ...PRESET_INFO[value] }),
)

/** 既定はプレビュー。最初の 1 回を最も安く・短く終わらせる。 */
export const DEFAULT_RENDER_PRESET: RenderPreset = 'preview_720p'

export const renderPresetLabel = (preset: RenderPreset): string => PRESET_INFO[preset].label

// --- 状態 ---

const STATUS_LABELS: Readonly<Record<RenderJobStatus, string>> = {
  queued: '順番待ち',
  rendering: '映像を組み立て中',
  encoding: 'エンコード中',
  succeeded: '完了',
  failed: '失敗',
  cancelled: '中止',
}

const STATUS_CLASSES: Readonly<Record<RenderJobStatus, string>> = {
  queued: 'bg-surface-2 text-text ring-line',
  rendering: 'bg-info/10 text-info ring-info/40',
  encoding: 'bg-info/10 text-info ring-info/40',
  succeeded: 'bg-ok/10 text-ok ring-ok/40',
  failed: 'bg-danger/10 text-danger ring-danger/40',
  cancelled: 'bg-warn/10 text-warn ring-warn/40',
}

export const renderStatusLabel = (status: RenderJobStatus): string => STATUS_LABELS[status]

export const renderStatusClassName = (status: RenderJobStatus): string => STATUS_CLASSES[status]

/** まだ動いているジョブ。引き直す価値があるかの判定に使う。 */
export const isRenderJobActive = (status: RenderJobStatus): boolean =>
  status === 'queued' || status === 'rendering' || status === 'encoding'

/**
 * まだ動いているジョブだけ。**入力は変更しない。**
 *
 * 「走っている書き出しがあるか」はダイアログの外でも要る（画面を閉じても
 * 書き出しは走り続ける）。判定を画面ごとに書き写さないため、ここに 1 つだけ置く。
 */
export const activeRenderJobs = <T extends { readonly status: RenderJobStatus }>(
  jobs: readonly T[],
): readonly T[] => jobs.filter((job) => isRenderJobActive(job.status))

export type RenderJobPhase = 'waiting' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type RenderJobView = {
  readonly phase: RenderJobPhase
  readonly statusLabel: string
  readonly statusClassName: string
  /**
   * 進捗の割合（0–100）。**まだ 1 度も報告が届いていないときは null。**
   * 0% と書くと「動いていて 0% まで進んだ」に見え、
   * 「始まっていない」「報告が来ていない」と区別できなくなる。
   */
  readonly progressPercent: number | null
  /** 1 行の説明。状態ごとに、次に何をすればよいかが分かる言葉にする。 */
  readonly detail: string
  readonly isActive: boolean
}

const percentOf = (progress: number): number =>
  Math.round(Math.min(Math.max(Number.isFinite(progress) ? progress : 0, 0), 1) * 100)

const runningDetail = (progress: number): string =>
  progress > 0
    ? `実行中です（${String(percentOf(progress))}% まで進みました）。`
    : '実行中です。進捗の報告はまだ届いていません。'

const settledDetail = (job: RenderJobLike): string => {
  if (job.status === 'failed') {
    return `失敗しました: ${job.error ?? '理由が記録されていません'}`
  }
  if (job.status === 'cancelled') return '中止されました。もう一度書き出してください。'
  return job.outputAssetId === null
    ? '完了しましたが、出力ファイルが記録されていません。書き出し直してください。'
    : '完了しました。出力を再生・ダウンロードできます。'
}

const phaseOf = (status: RenderJobStatus): RenderJobPhase => {
  if (status === 'queued') return 'waiting'
  if (status === 'rendering' || status === 'encoding') return 'running'
  if (status === 'succeeded') return 'succeeded'
  return status === 'failed' ? 'failed' : 'cancelled'
}

/**
 * ジョブ 1 件の見え方をここで決める。画面側で status を分岐させない。
 * 失敗・中止では進捗を出さない。止まった位置の数字は「進んでいる」に読める。
 */
export const describeRenderJob = (job: RenderJobLike): RenderJobView => {
  const phase = phaseOf(job.status)
  const base = {
    phase,
    statusLabel: renderStatusLabel(job.status),
    statusClassName: renderStatusClassName(job.status),
    isActive: isRenderJobActive(job.status),
  }

  if (phase === 'waiting') {
    return {
      ...base,
      progressPercent: null,
      detail: 'まだ始まっていません。前の書き出しが終わるのを待っています。',
    }
  }
  if (phase === 'running') {
    return {
      ...base,
      progressPercent: job.progress > 0 ? percentOf(job.progress) : null,
      detail: runningDetail(job.progress),
    }
  }
  return {
    ...base,
    progressPercent: phase === 'succeeded' ? 100 : null,
    detail: settledDetail(job),
  }
}

/** 実時間の経過秒。完了していれば投入から完了まで、動いていれば現在まで。 */
export const renderElapsedSec = (job: RenderJobLike, nowMs: number): number => {
  const endMs = job.finishedAt === null ? nowMs : job.finishedAt.getTime()
  return Math.max(endMs - job.createdAt.getTime(), 0) / 1_000
}

/**
 * 最新のジョブ。API の並び順に依存せず createdAt で決める。
 * 同時刻なら配列の後ろを新しいとみなす（追記順）。空なら null。
 */
export const latestRenderJob = <T extends { readonly createdAt: Date }>(
  jobs: readonly T[],
): T | null =>
  jobs.reduce<T | null>(
    (newest, job) =>
      newest === null || job.createdAt.getTime() >= newest.createdAt.getTime() ? job : newest,
    null,
  )

/** 新しい順。**入力は変更しない。** */
export const sortRenderJobsByNewest = <T extends { readonly createdAt: Date }>(
  jobs: readonly T[],
): readonly T[] => [...jobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

/**
 * 日時の表示（`2026-10-02 22:52`）。**この Mac の時刻で出す**（制作者 2026-10-03。UTC だと読み替えが要った）。
 *
 * 以前は hydration のずれを避けて UTC 固定にしていた。書き出し画面はブラウザで読み込んでから描く
 * （サーバで描かない）ので、ブラウザの時刻で書いてもずれない。サーバで描く画面に使うときは `timeZone` を渡すこと。
 */
export const formatJobTime = (date: Date, timeZone?: string): string => {
  if (!Number.isFinite(date.getTime())) return '日時不明'
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

// --- 拒否理由のまとめ方 ---

/**
 * **指摘（TimelineIssue）のまとめ方はここに置かない。**
 * `@/lib/issue-grouping` の `groupTimelineIssues` が正で、画面は
 * `TimelineIssuePanel` をそのまま使う。code のラベルを 2 箇所に持つと必ずズレる
 * （lessons L-016）。
 *
 * ここが扱うのは 422 の `fields` だけ。こちらは code を持たない**文字列の列**で、
 * 指摘とは別物。分類し直すと判定がもう 1 箇所増えるので、件数だけ残して先頭を出す。
 */

export type ReasonSummary = {
  readonly total: number
  readonly shown: readonly string[]
  readonly hiddenCount: number
}

/** 拒否理由は code を持たない文字列の列。件数を残したまま先頭だけ出す。 */
export const REASON_SAMPLE_LIMIT = 5

/**
 * 422 の `fields.timeline` をそのまま並べると読めない。
 * **理由を分類し直さない。** サーバが送ったのは文章だけで、規則を推測して
 * 分類すると、判定がもう 1 箇所に増える（lessons L-016）。
 */
export const summarizeReasons = (
  reasons: readonly string[],
  limit: number = REASON_SAMPLE_LIMIT,
): ReasonSummary => {
  const shown = reasons.slice(0, Math.max(limit, 0))
  return { total: reasons.length, shown, hiddenCount: reasons.length - shown.length }
}
