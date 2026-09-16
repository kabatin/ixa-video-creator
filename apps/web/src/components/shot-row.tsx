import type { Shot } from '@ixa/domain'
import Link from 'next/link'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { formatCamera, formatSeconds } from '@/lib/shot-display'
import { shotDetailHref } from '@/lib/shot-links'

export type ShotRowProps = {
  readonly shot: Shot
}

export const ShotRow = ({ shot }: ShotRowProps) => (
  <tr className="border-t border-slate-200 align-top">
    <th scope="row" className="px-4 py-3 text-left text-sm font-semibold text-slate-900">
      {shot.code}
    </th>
    <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-700">
      <div>{formatSeconds(shot.startSec)}</div>
      <div className="text-xs text-slate-500">尺 {formatSeconds(shot.durationSec)}</div>
    </td>
    <td className="px-4 py-3 text-sm text-slate-700">
      <p className="max-w-md whitespace-pre-wrap break-words">
        {shot.description === '' ? '—' : shot.description}
      </p>
      {shot.mood !== null && <p className="mt-1 text-xs text-slate-500">mood: {shot.mood}</p>}
    </td>
    <td className="px-4 py-3 text-sm text-slate-700">{formatCamera(shot.camera)}</td>
    <td className="px-4 py-3">
      <ShotStatusBadge status={shot.status} />
    </td>
    <td className="whitespace-nowrap px-4 py-3 text-sm">
      <Link
        href={shotDetailHref(shot)}
        className="font-medium text-slate-900 underline hover:text-slate-600"
      >
        Take を見る
      </Link>
    </td>
  </tr>
)
