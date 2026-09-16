import Link from 'next/link'
import { FourViewBadge } from '@/components/four-view-badge'
import { characterDetailHref } from '@/lib/character-links'
import type { CharacterSummary } from '@/lib/character-summary'

export type CharacterRowProps = {
  readonly summary: CharacterSummary
}

export const CharacterRow = ({ summary }: CharacterRowProps) => {
  const { character } = summary

  return (
    <tr className="border-t border-slate-200 align-top">
      <th scope="row" className="px-4 py-3 text-left text-sm font-semibold text-slate-900">
        {character.name}
      </th>
      <td className="px-4 py-3 text-sm text-slate-700">{character.displayName}</td>
      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-700">
        <div>{summary.lookCount} 件</div>
        <div className="text-xs text-slate-500">
          既定 {summary.defaultLookName ?? '—'}
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-700">
        {summary.identityImageCount === 0 ? (
          <span className="text-amber-800">未登録</span>
        ) : (
          `${String(summary.identityImageCount)} 枚`
        )}
      </td>
      <td className="px-4 py-3">
        <FourViewBadge present={summary.hasFourView} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm">
        <Link
          href={characterDetailHref(character.id)}
          className="font-medium text-slate-900 underline hover:text-slate-600"
        >
          編集する
        </Link>
      </td>
    </tr>
  )
}
