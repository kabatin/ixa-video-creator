'use client'

import type { CharacterLook, CharacterLookId } from '@ixa/domain'

export type LookSelectorProps = {
  readonly looks: readonly CharacterLook[]
  readonly selectedLookId: CharacterLookId | null
  readonly onSelect: (id: CharacterLookId) => void
}

/** Look の切り替え。既定の Look と canonical frame の有無が一覧の時点で分かるようにする。 */
export const LookSelector = ({ looks, selectedLookId, onSelect }: LookSelectorProps) => (
  <ul className="flex flex-wrap gap-2">
    {looks.map((look) => {
      const selected = look.id === selectedLookId
      return (
        <li key={look.id}>
          <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            onClick={() => {
              onSelect(look.id)
            }}
            className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left ${
              selected
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
            }`}
          >
            <span className="text-sm font-semibold">{look.name}</span>
            <span className={`text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
              {look.key}
              {look.era === null ? '' : ` / ${look.era}`}
            </span>
            <span className="flex flex-wrap gap-1">
              {look.isDefault && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900">
                  既定
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  look.canonicalFrameAssetId === null
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {look.canonicalFrameAssetId === null ? 'canonical frame なし' : 'canonical frame'}
              </span>
            </span>
          </button>
        </li>
      )
    })}
  </ul>
)
