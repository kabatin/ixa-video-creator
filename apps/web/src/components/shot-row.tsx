'use client'

import type { Shot } from '@ixa/domain'
import Link from 'next/link'
import { InlineTextCell } from '@/components/inline-text-cell'
import { ShotDeleteButton } from '@/components/shot-editor'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { formatClock, formatDuration } from '@/lib/format-time'
import { formatCamera } from '@/lib/shot-display'
import { shotDetailHref } from '@/lib/shot-links'

/**
 * Shot 一覧の 1 行。**行の中で説明と mood を直せる。**
 *
 * 以前は 27 件を直すのに詳細へ 27 回入って戻っていた（制作者 2026-09-18）。
 * 一覧から出ずに直せる欄を置き、往復を無くす。
 * カメラや時間は詳細で直す。行の中に収まらない量の入力があるため。
 */

export type ShotRowProps = {
  readonly shot: Shot
  readonly selected: boolean
  readonly busy: boolean
  readonly onToggle: (shot: Shot) => void
  readonly onSaveDescription: (shot: Shot, next: string) => Promise<void>
  readonly onSaveMood: (shot: Shot, next: string) => Promise<void>
}

export const ShotRow = ({
  shot,
  selected,
  busy,
  onToggle,
  onSaveDescription,
  onSaveMood,
}: ShotRowProps) => (
  <tr className={`border-t border-line align-top ${selected ? 'bg-info/10' : ''}`}>
    <td className="px-3 py-3">
      <input
        type="checkbox"
        checked={selected}
        disabled={busy}
        aria-label={`${shot.code} を選択`}
        onChange={() => {
          onToggle(shot)
        }}
        className="h-4 w-4 rounded border-line-strong"
      />
    </td>
    <th scope="row" className="px-4 py-3 text-left text-sm font-semibold text-text">
      {shot.code}
    </th>
    <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-text">
      <div>{formatClock(shot.startSec)}</div>
      <div className="text-xs text-muted">尺 {formatDuration(shot.durationSec)}</div>
    </td>
    <td className="min-w-72 px-4 py-3 text-sm text-text">
      <InlineTextCell
        value={shot.description}
        multiline
        placeholder="説明を追加"
        label={`${shot.code} の説明`}
        disabled={busy}
        onSave={(next) => onSaveDescription(shot, next)}
      />
      <div className="mt-1 text-xs text-muted">
        <InlineTextCell
          // `null` は未設定。部品は文字列だけを受けるので、ここで空文字に畳む（L-021 の逆の取り違えに注意）。
          value={shot.mood ?? ''}
          placeholder="mood を追加"
          label={`${shot.code} の mood`}
          disabled={busy}
          onSave={(next) => onSaveMood(shot, next)}
        />
      </div>
    </td>
    <td className="px-4 py-3 text-sm text-text">{formatCamera(shot.camera)}</td>
    <td className="px-4 py-3">
      <ShotStatusBadge status={shot.status} />
    </td>
    <td className="px-4 py-3 text-sm">
      <div className="flex flex-col items-start gap-2">
        <Link
          href={shotDetailHref(shot)}
          className="whitespace-nowrap font-medium text-text underline hover:text-muted"
        >
          Take を見る
        </Link>
        {/* 重なった Shot は人が選別して消す。その選別を一覧の上で完結させる。 */}
        <ShotDeleteButton shot={shot} size="sm" after="refresh" />
      </div>
    </td>
  </tr>
)
