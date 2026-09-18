'use client'

import type { Shot } from '@ixa/domain'
import Link from 'next/link'
import { InlineTextCell } from '@/components/inline-text-cell'
import { ShotDeleteButton } from '@/components/shot-editor'
import { RowMenu } from '@/components/row-menu'
import { ShotPoster } from '@/components/shot-poster'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { formatClock, formatDuration } from '@/lib/format-time'
import { formatCamera } from '@/lib/shot-display'
import { shotDetailHref } from '@/lib/shot-links'
import type { PosterView } from '@/lib/shot-posters'

/**
 * Shot 一覧の 1 行。**行の中で説明と mood を直せる。**
 *
 * 以前は 27 件を直すのに詳細へ 27 回入って戻っていた（制作者 2026-09-18）。
 * 一覧から出ずに直せる欄を置き、往復を無くす。
 * カメラや時間は詳細で直す。行の中に収まらない量の入力があるため。
 */

export type ShotRowProps = {
  readonly shot: Shot
  /** 採用 Take のサムネイル。**絵が無いときも理由を連れて来る**（L-015）。 */
  readonly poster: PosterView
  readonly selected: boolean
  readonly busy: boolean
  readonly onToggle: (shot: Shot) => void
  readonly onSaveDescription: (shot: Shot, next: string) => Promise<void>
  readonly onSaveMood: (shot: Shot, next: string) => Promise<void>
}

export const ShotRow = ({
  shot,
  poster,
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
    <td className="px-2 py-3">
      <ShotPoster
        url={poster.url}
        reason={poster.reason}
        alt={`${shot.code} のサムネイル`}
        size="row"
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
      <div className="flex items-center justify-end gap-2">
        <Link
          href={shotDetailHref(shot)}
          className="whitespace-nowrap font-medium text-text underline hover:text-muted"
        >
          Take を見る
        </Link>
        {/**
         * **消す操作はメニューの中へ。** 以前は「Take を見る」のすぐ下に
         * 赤い削除ボタンが並んでおり、制作者から「近すぎて怖い」と報告があった
         * （2026-09-18）。確認を挟んでいても、押し間違えた次の一手で消える位置は危ない。
         * 重なった Shot を一覧の上で選別して消せること自体は残す。
         */}
        <RowMenu label={`${shot.code} のその他の操作`}>
          <ShotDeleteButton shot={shot} size="sm" after="refresh" />
        </RowMenu>
      </div>
    </td>
  </tr>
)
