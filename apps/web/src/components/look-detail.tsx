'use client'

import type { CharacterLook } from '@ixa/domain'
import { TokenList } from '@/components/token-list'

export type LookDetailProps = {
  readonly look: CharacterLook
  readonly busy: boolean
  readonly onMakeDefault: () => void
  readonly onDelete: () => void
}

/** 選択中の Look の属性。既定かどうかを断定的に出す。 */
export const LookDetail = ({ look, busy, onMakeDefault, onDelete }: LookDetailProps) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{look.name}</h3>
        <p className="mt-1 text-xs text-slate-500">
          key {look.key}
          {look.era === null ? '' : ` / 時代 ${look.era}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {look.isDefault ? (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-900">
            既定の Look
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onMakeDefault}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            既定にする
          </button>
        )}
        <button
          type="button"
          disabled={busy || look.isDefault}
          onClick={onDelete}
          title={look.isDefault ? '既定の Look は削除できません' : undefined}
          className="text-xs text-red-700 underline hover:text-red-900 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          削除
        </button>
      </div>
    </div>

    {look.description !== '' && (
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">
        {look.description}
      </p>
    )}

    <dl className="mt-3 grid gap-3 sm:grid-cols-3">
      <TokenList label="衣装トークン" tokens={look.wardrobeTokens} />
      <TokenList label="スタイル" tokens={look.styleTokens} />
      <TokenList label="配色" tokens={look.colorPalette} />
    </dl>
  </div>
)
