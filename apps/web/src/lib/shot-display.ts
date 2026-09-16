import {
  cameraToPromptFragment,
  type HumanVerdict,
  type ReviewStatus,
  type Shot,
  type ShotCamera,
  type ShotStatus,
  type SourceTypeName,
} from '@ixa/domain'
import { formatDuration, formatSpan } from '@/lib/format-time'

/**
 * Shot / Take の表示用ラベルと色。
 * キーをドメインの union にすることで、enum が増えたときに型で気付ける。
 *
 * 色は白地・淡色地ともにコントラスト比 4.5 以上を満たすものだけを使う。
 * 状態は色だけで伝えない。呼び出し側は必ずラベルも一緒に出すこと。
 */

const SHOT_STATUS_LABELS: Readonly<Record<ShotStatus, string>> = {
  draft: '下書き',
  ready: '生成可能',
  generating: '生成中',
  review: 'レビュー待ち',
  approved: '承認済み',
  blocked: '要判断',
}

/** 実測コントラスト比: slate 9.45 / sky 6.59 / blue 7.15 / amber 8.15 / emerald 6.78 / red 6.80。 */
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

/** `skipped` は slate-500 だった。slate-100 地で 4.34 と基準未満のため slate-600（6.92）にする。 */
const REVIEW_STATUS_CLASSES: Readonly<Record<ReviewStatus, string>> = {
  pending: 'bg-slate-100 text-slate-700',
  passed: 'bg-emerald-100 text-emerald-800',
  warned: 'bg-amber-100 text-amber-900',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-slate-100 text-slate-600',
}

export const reviewStatusLabel = (status: ReviewStatus): string => REVIEW_STATUS_LABELS[status]

export const reviewStatusClassName = (status: ReviewStatus): string => REVIEW_STATUS_CLASSES[status]

const HUMAN_VERDICT_LABELS: Readonly<Record<HumanVerdict, string>> = {
  unreviewed: '人手未確認',
  approved: '人手承認',
  rejected: '人手却下',
}

export const humanVerdictLabel = (verdict: HumanVerdict): string => HUMAN_VERDICT_LABELS[verdict]

/**
 * 生成方式の日本語ラベル。
 * **生の enum を画面に出さないこと。** `ai_video` は利用者の言葉ではない。
 */
const SOURCE_TYPE_LABELS: Readonly<Record<SourceTypeName, string>> = {
  ai_video: 'AI 動画生成',
  ai_image_to_video: 'AI 画像から動画',
  still_image: '静止画',
  existing_footage: '既存素材',
  motion_graphics: 'モーショングラフィックス',
  generated_graphic: 'AI 画像生成',
}

export const sourceTypeLabel = (name: SourceTypeName): string => SOURCE_TYPE_LABELS[name]

/**
 * 秒の書式は `@/lib/format-time` が唯一の正。ここでは桁数を決め直さない。
 * 名前だけ残しているのは既存の呼び出し側を壊さないため。新しいコードは
 * `formatDuration` / `formatClock` / `formatSpan` を直接使うこと。
 */
export const formatSeconds = (seconds: number): string => formatDuration(seconds)

/** `0:03.75 – 0:07.50（3.75s）`。位置は時計形式、尺は秒で出す。 */
export const formatTimecode = (shot: Pick<Shot, 'startSec' | 'durationSec'>): string =>
  formatSpan(shot.startSec, shot.durationSec)

export const formatUsd = (amountUsd: number): string => `$${amountUsd.toFixed(3)}`

/** カメラ指定の一行要約。ドメインのプロンプト断片をそのまま使い、表記を二重定義しない。 */
export const formatCamera = (camera: ShotCamera): string => cameraToPromptFragment(camera)

/** 生成中は Take 一覧をポーリングする。判定をここに一本化する。 */
export const isGeneratingStatus = (status: ShotStatus): boolean => status === 'generating'
