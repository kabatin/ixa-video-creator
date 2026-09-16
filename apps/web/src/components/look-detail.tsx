'use client'

import type { CharacterLook } from '@ixa/domain'
import { TokenList } from '@/components/token-list'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'

export type LookDetailProps = {
  readonly look: CharacterLook
  readonly busy: boolean
  readonly onMakeDefault: () => void
  readonly onDelete: () => void
}

/**
 * 選択中の Look の属性。既定かどうかを断定的に出す。
 *
 * 削除は**取り消せない**。画面に戻す導線が無いので、確認を挟んでから実行する。
 */
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
      <div className="flex flex-wrap items-start gap-2">
        {look.isDefault ? (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-900">
            既定の Look
          </span>
        ) : (
          <Button size="sm" disabled={busy} onClick={onMakeDefault}>
            既定にする
          </Button>
        )}
        <ConfirmButton
          size="sm"
          label={`${WORDING.delete}（Look）`}
          message={deleteConfirmMessage(`Look「${look.name}」`)}
          disabled={busy || look.isDefault}
          onConfirm={onDelete}
        />
        {look.isDefault && (
          // 以前は理由を `title` に入れていたが、触る端末とキーボードには出ない。文字で出す。
          <p className="text-xs text-slate-500">
            {`既定の Look は${WORDING.delete}できません`}
          </p>
        )}
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
