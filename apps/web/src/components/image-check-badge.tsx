'use client'

import { IMAGE_CHECK_MARK_LABELS, imageCheckReason, type WireImageCheck } from '@/lib/image-check'

/**
 * 作った絵のチェックの印（ADR-0055）。理由はツールチップに出す。見ていない絵は「未チェック」。
 */

const TONE: Readonly<Record<WireImageCheck['mark'], string>> = {
  pass: 'bg-ok/15 text-ok',
  review: 'bg-warn/15 text-warn',
  retry: 'bg-danger/15 text-danger',
  unchecked: 'bg-surface-2 text-muted',
}

export type ImageCheckBadgeProps = {
  readonly check: WireImageCheck | null
}

export const ImageCheckBadge = ({ check }: ImageCheckBadgeProps) => {
  const mark = check?.mark ?? 'unchecked'
  const reason = imageCheckReason(check)
  return (
    <span
      title={reason ?? undefined}
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ${TONE[mark]}`}
    >
      {IMAGE_CHECK_MARK_LABELS[mark]}
    </span>
  )
}
