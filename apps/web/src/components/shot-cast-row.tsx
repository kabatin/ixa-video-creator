'use client'

import type { Character, CharacterLook } from '@ixa/domain'
import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
  LOOK_MISSING_MESSAGE,
  PROMINENCE_OPTIONS,
  UNSAVED_ROW_CONFIRM_MESSAGE,
  describeCharacter,
  looksOf,
  toCharacterOptions,
  toLookOptions,
  unlinkConfirmMessage,
  type CastRow,
  type CastRowErrors,
} from '@/lib/shot-cast-form'
import { WORDING } from '@/lib/wording'

/**
 * 登場人物 1 人分の編集行。
 *
 * Look を**必ず選ばせる**（docs/DOMAIN.md §5）。既定 Look はキャラクターを選んだ時点で
 * 親が埋めるが、select としては常に出す。既定を暗黙で使うと、後で既定を付け替えた日に
 * 過去の Shot の衣装が黙って変わる。
 */
export type ShotCastRowProps = {
  readonly row: CastRow
  readonly characters: readonly Character[]
  /** 全キャラクターの Look。行の中でそのキャラクターのものだけに絞る。 */
  readonly looks: readonly CharacterLook[]
  readonly errors: CastRowErrors
  readonly disabled: boolean
  /** 保存済みの行か。解除が API を呼ぶか、下書きを取り消すだけかがこれで変わる。 */
  readonly saved: boolean
  readonly onChange: (patch: Partial<Omit<CastRow, 'key'>>) => void
  readonly onSelectCharacter: (characterId: string) => void
  readonly onUnlink: () => void
}

export const ShotCastRow = ({
  row,
  characters,
  looks,
  errors,
  disabled,
  saved,
  onChange,
  onSelectCharacter,
  onUnlink,
}: ShotCastRowProps) => {
  const available = looksOf(row.characterId, looks)
  const name = describeCharacter(row.characterId, characters)

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          id={`cast-character-${row.key}`}
          label="キャラクター"
          value={row.characterId}
          options={toCharacterOptions(characters)}
          disabled={disabled}
          error={errors.characterId}
          onChange={onSelectCharacter}
        />

        <SelectField
          id={`cast-look-${row.key}`}
          label="Look（衣装）"
          value={row.lookId}
          options={toLookOptions(available)}
          disabled={disabled || available.length === 0}
          error={errors.lookId}
          onChange={(lookId) => {
            onChange({ lookId })
          }}
        />

        <SelectField
          id={`cast-prominence-${row.key}`}
          label="映り方"
          value={row.prominence}
          options={PROMINENCE_OPTIONS}
          disabled={disabled}
          error={errors.prominence}
          onChange={(prominence) => {
            onChange({ prominence })
          }}
        />

        <TextField
          id={`cast-order-${row.key}`}
          label="表示順"
          value={row.order}
          disabled={disabled}
          error={errors.order}
          onChange={(order) => {
            onChange({ order })
          }}
        />
      </div>

      {row.characterId !== '' && available.length === 0 && errors.lookId === undefined && (
        <p role="status" className="mt-2 text-sm text-warn">
          {LOOK_MISSING_MESSAGE}
        </p>
      )}

      <div className="mt-3">
        <ConfirmButton
          label={WORDING.unlink}
          message={saved ? unlinkConfirmMessage(name) : UNSAVED_ROW_CONFIRM_MESSAGE}
          size="sm"
          disabled={disabled}
          onConfirm={onUnlink}
        />
      </div>
    </li>
  )
}
