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
 * 色は役割の名前だけで持つ（PHASE 5.9）。実際の値は `globals.css` のトークンにあり、
 * ダークとライトのコントラストはそこで保証する。ここで素の色名を書かない。
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

/**
 * 下地は役割の色の薄い透過、文字と枠は同じ役割で揃える。
 * `ready` と `generating` は同じ `info` を使うため、**濃さで分ける**
 * （進行中の方が強い）。色だけで区別させないので、ラベルは必ず併記する。
 */
const SHOT_STATUS_CLASSES: Readonly<Record<ShotStatus, string>> = {
  draft: 'bg-surface-2 text-text ring-line',
  ready: 'bg-info/10 text-info ring-info/40',
  generating: 'bg-info/25 text-info ring-info/60',
  review: 'bg-warn/10 text-warn ring-warn/40',
  approved: 'bg-ok/10 text-ok ring-ok/40',
  blocked: 'bg-danger/10 text-danger ring-danger/40',
}

export const shotStatusLabel = (status: ShotStatus): string => SHOT_STATUS_LABELS[status]

export const shotStatusClassName = (status: ShotStatus): string => SHOT_STATUS_CLASSES[status]

/**
 * 状態の点（ストーリーボードのカード・一覧の行）。バッジと同じ色の役割を**塗りで**使う。
 * 点は小さいので色だけでは読めない。使う側は必ずラベルを title / 読み上げに渡すこと。
 */
const SHOT_STATUS_DOTS: Readonly<Record<ShotStatus, string>> = {
  draft: 'bg-muted',
  ready: 'bg-info',
  generating: 'bg-info animate-pulse',
  review: 'bg-warn',
  approved: 'bg-ok',
  blocked: 'bg-danger',
}

export const shotStatusDotClassName = (status: ShotStatus): string => SHOT_STATUS_DOTS[status]

const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  pending: '自動レビュー未実施',
  passed: '自動レビュー合格',
  warned: '自動レビュー警告',
  failed: '自動レビュー不合格',
  skipped: '自動レビュー省略',
}

/** `skipped` は「実施しなかった」。判定が出た 3 つより一段弱い文字にして区別する。 */
const REVIEW_STATUS_CLASSES: Readonly<Record<ReviewStatus, string>> = {
  pending: 'bg-surface-2 text-text',
  passed: 'bg-ok/10 text-ok',
  warned: 'bg-warn/10 text-warn',
  failed: 'bg-danger/10 text-danger',
  skipped: 'bg-surface-2 text-muted',
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
