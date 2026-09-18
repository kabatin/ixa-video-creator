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
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-line-strong bg-surface text-text hover:bg-surface-2'
            }`}
          >
            <span className="text-sm font-semibold">{look.name}</span>
            <span className={`text-xs ${selected ? 'text-accent-fg/80' : 'text-muted'}`}>
              {look.key}
              {look.era === null ? '' : ` / ${look.era}`}
            </span>
            <span className="flex flex-wrap gap-1">
              {look.isDefault && (
                <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-text">
                  既定
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  look.canonicalFrameAssetId === null ? 'bg-bg text-warn' : 'bg-bg text-ok'
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
