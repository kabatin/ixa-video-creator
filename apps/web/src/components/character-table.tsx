import { CharacterRow } from '@/components/character-row'
import type { CharacterSummary } from '@/lib/character-summary'

export type CharacterTableProps = {
  readonly summaries: readonly CharacterSummary[]
}

const HEADERS: readonly string[] = ['名前', '表示名', 'Look', '識別画像', '四面図', '']

export const CharacterTable = ({ summaries }: CharacterTableProps) => (
  <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
    <table className="min-w-full border-collapse text-left">
      <caption className="sr-only">キャラクター一覧</caption>
      <thead className="bg-surface-2">
        <tr>
          {HEADERS.map((header, index) => (
            <th
              key={header === '' ? `actions-${String(index)}` : header}
              scope="col"
              className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {summaries.map((summary) => (
          <CharacterRow key={summary.character.id} summary={summary} />
        ))}
      </tbody>
    </table>
  </div>
)
