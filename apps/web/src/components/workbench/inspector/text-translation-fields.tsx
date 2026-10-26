'use client'

import { DEFAULT_TRANSLATION_SCALE, TextStyle } from '@ixa/domain'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { withStyle } from '@/lib/text-style-form'

/**
 * 2 段字幕の下の段（ADR-0061）。訳文と、その大きさ（上の段に対する割合）。
 * 訳文は空にすると外れる（api が鍵ごと外す）。大きさは訳文があるときだけ出す。
 */

const SCALE_OPTIONS = [0.4, 0.5, 0.6, 0.7, 0.8, 1].map((scale) => ({
  value: String(scale),
  label: `${String(Math.round(scale * 100))}%${scale === DEFAULT_TRANSLATION_SCALE ? '（既定）' : ''}`,
}))

const translationOf = (params: Record<string, unknown>): string =>
  typeof params.translation === 'string' ? params.translation : ''

const scaleOf = (params: Record<string, unknown>): number => {
  const style = TextStyle.safeParse(params.style)
  return (style.success ? style.data.translationScale : undefined) ?? DEFAULT_TRANSLATION_SCALE
}

export const TextTranslationFields = ({
  params,
  onSave,
}: {
  readonly params: Record<string, unknown>
  /** 新しい params を丸ごと送る（ほかの印と見た目は残す）。 */
  readonly onSave: (params: Record<string, unknown>) => Promise<void>
}) => {
  const translation = translationOf(params)
  return (
    <>
      <AutoSaveField
        label="訳文（2 段目）"
        multiline
        value={translation}
        placeholder="英語の字幕など（空なら 1 段だけ）"
        onSave={(next) => onSave({ ...params, translation: next.trim() })}
      />
      {translation !== '' && (
        <AutoSaveSelect
          label="2 段目の大きさ"
          value={String(scaleOf(params))}
          options={SCALE_OPTIONS}
          onSave={(next) => onSave(withStyle(params, { translationScale: Number(next) }))}
        />
      )}
    </>
  )
}
