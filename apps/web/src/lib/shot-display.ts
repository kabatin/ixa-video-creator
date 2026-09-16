import {
  cameraToPromptFragment,
  type HumanVerdict,
  type ReviewStatus,
  type Shot,
  type ShotCamera,
  type ShotStatus,
} from '@ixa/domain'

/**
 * Shot / Take の表示用ラベルと色。
 * キーをドメインの union にすることで、enum が増えたときに型で気付ける。
 */

const SHOT_STATUS_LABELS: Readonly<Record<ShotStatus, string>> = {
  draft: '下書き',
  ready: '生成可能',
  generating: '生成中',
  review: 'レビュー待ち',
  approved: '承認済み',
  blocked: '要判断',
}

const SHOT_STATUS_CLASSES: Readonly<Record<ShotStatus, string>> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-200',
  ready: 'bg-sky-100 text-sky-800 ring-sky-200',
  generating: 'bg-blue-100 text-blue-800 ring-blue-300',
  review: 'bg-amber-100 text-amber-900 ring-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  blocked: 'bg-red-100 text-red-800 ring-red-300',
}

export const shotStatusLabel = (status: ShotStatus): string => SHOT_STATUS_LABELS[status]

export const shotStatusClassName = (status: ShotStatus): string => SHOT_STATUS_CLASSES[status]

const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  pending: '自動レビュー未実施',
  passed: '自動レビュー合格',
  warned: '自動レビュー警告',
  failed: '自動レビュー不合格',
  skipped: '自動レビュー省略',
}

const REVIEW_STATUS_CLASSES: Readonly<Record<ReviewStatus, string>> = {
  pending: 'bg-slate-100 text-slate-700',
  passed: 'bg-emerald-100 text-emerald-800',
  warned: 'bg-amber-100 text-amber-900',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-slate-100 text-slate-500',
}

export const reviewStatusLabel = (status: ReviewStatus): string => REVIEW_STATUS_LABELS[status]

export const reviewStatusClassName = (status: ReviewStatus): string => REVIEW_STATUS_CLASSES[status]

const HUMAN_VERDICT_LABELS: Readonly<Record<HumanVerdict, string>> = {
  unreviewed: '人手未確認',
  approved: '人手承認',
  rejected: '人手却下',
}

export const humanVerdictLabel = (verdict: HumanVerdict): string => HUMAN_VERDICT_LABELS[verdict]

/** 秒は小数第 2 位まで。フレーム数へ丸めない（CLAUDE.md 規約 3）。 */
export const formatSeconds = (seconds: number): string => `${seconds.toFixed(2)}s`

export const formatTimecode = (shot: Pick<Shot, 'startSec' | 'durationSec'>): string =>
  `${formatSeconds(shot.startSec)} / ${formatSeconds(shot.durationSec)}`

export const formatUsd = (amountUsd: number): string => `$${amountUsd.toFixed(3)}`

/** カメラ指定の一行要約。ドメインのプロンプト断片をそのまま使い、表記を二重定義しない。 */
export const formatCamera = (camera: ShotCamera): string => cameraToPromptFragment(camera)

/** 生成中は Take 一覧をポーリングする。判定をここに一本化する。 */
export const isGeneratingStatus = (status: ShotStatus): boolean => status === 'generating'
