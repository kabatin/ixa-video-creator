import { formatApproxDuration } from '@/lib/format-time'
import type { WireBulkSpeakResult } from '@/lib/narration-api'

/**
 * ナレーションのパネルに出す言葉（ADR-0038）。**React を含まない。**
 * 長さは format-time の書式（「約 14 秒」）で、内部の名前（ジョブの状態の符号など）は出さない。
 */

export type Note = { readonly text: string; readonly tone: 'muted' | 'warn' | 'danger' }

/** 作品の長さより長いとみなす余り（秒）。見積もりなので、少しの超えでは騒がない。 */
const OVER_TOLERANCE_SEC = 0.5

/** 合計の長さと、作品の長さとの比べ（例: 15 秒 CM に収まるか）。 */
export const narrationLengthNote = (totalEstimatedSec: number, projectDurationSec: number | null): Note => {
  const total = `合計 ${formatApproxDuration(totalEstimatedSec)}`
  if (projectDurationSec === null) return { text: total, tone: 'muted' }
  const both = `${total} / 作品の長さ ${formatApproxDuration(projectDurationSec)}`
  const over = totalEstimatedSec - projectDurationSec
  return over > OVER_TOLERANCE_SEC
    ? { text: `${both}。${formatApproxDuration(over)}長いので、行を削るか速さを上げてください`, tone: 'warn' }
    : { text: both, tone: 'muted' }
}

type LineLike = {
  readonly job: { readonly status: string; readonly error: { readonly message: string } | null } | null
  readonly stale: boolean
  readonly takes: readonly unknown[]
  readonly selectedTakeId: string | null
}

/** 行の状態の一言。できていて新しければ null（何も言わない）。 */
export const lineStatus = (line: LineLike): Note | null => {
  if (line.job?.status === 'queued' || line.job?.status === 'running') return { text: '声を作っています…', tone: 'muted' }
  if (line.job?.status === 'failed') {
    return { text: `声を作れませんでした: ${line.job.error?.message ?? '理由が届きませんでした。'}`, tone: 'danger' }
  }
  if (line.selectedTakeId === null && line.takes.length === 0) return { text: '声はまだありません', tone: 'muted' }
  if (line.stale) return { text: '原稿か声を変えたので、作り直しが要ります', tone: 'warn' }
  return null
}

/** 「まとめて声にする」の結果。頼んだ・使い回した・飛ばしたを数で言う。 */
export const bulkSpeakSummary = (result: WireBulkSpeakResult): string => {
  const parts = [
    result.jobIds.length > 0 ? `${String(result.jobIds.length)} 行を声にしています。` : '',
    result.reusedTakeIds.length > 0 ? `${String(result.reusedTakeIds.length)} 行は前に作った声を使いました。` : '',
  ].join('')
  const skipped = [
    result.skipped.noVoice > 0 ? `声が決まっていない行が ${String(result.skipped.noVoice)} 行` : '',
    result.skipped.active > 0 ? `作っている途中の行が ${String(result.skipped.active)} 行` : '',
  ].filter((part) => part !== '')
  const tail = skipped.length > 0 ? `${skipped.join('、')}あります。` : ''
  const text = `${parts}${tail}`
  return text === '' ? '声にする行はありません（どの行も声ができています）。' : text
}
