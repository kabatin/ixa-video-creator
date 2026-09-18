'use client'

import type { Location, LocationId } from '@ixa/domain'
import { useState } from 'react'
import { LocationField } from '@/components/location-field'
import { Button } from '@/components/ui/button'
import { toLocationFieldValue, toLocationPatch } from '@/lib/shot-location'
import { WORDING } from '@/lib/wording'

/** 保存の結果。成功も失敗も同じ場所に出し、押したのに何も起きないように見えるのを防ぐ。 */
export type LocationSaveFeedback = {
  readonly tone: 'success' | 'error'
  readonly message: string
}

export type ShotLocationEditorProps = {
  /** 空配列は「未登録」。取得自体に失敗したときは `loadError` で区別する（作成フォームと同じ扱い）。 */
  readonly locations: readonly Location[]
  readonly loadError?: string
  /** 保存済みの値。保存が通るたびに親が差し替える。 */
  readonly locationId: LocationId | null
  readonly saving: boolean
  /** 生成中など、他の操作で画面が動いている間は触らせない。 */
  readonly disabled: boolean
  readonly feedback: LocationSaveFeedback | null
  readonly onSave: (locationId: LocationId | null) => void
}

const FEEDBACK_CLASS = {
  success: 'text-ok',
  error: 'text-danger',
} as const

export const ShotLocationEditor = ({
  locations,
  loadError,
  locationId,
  saving,
  disabled,
  feedback,
  onSave,
}: ShotLocationEditorProps) => {
  // 選びかけの値は保存するまで確定しない。失敗しても選び直しからやり直さずに済む。
  const [draft, setDraft] = useState<string>(() => toLocationFieldValue(locationId))
  const [invalid, setInvalid] = useState<string | undefined>(undefined)

  // select を出せない状況（未登録・取得失敗）では選び直す対象が無い。
  const selectable = loadError === undefined && locations.length > 0
  /**
   * 一覧が引けなくても、**既に付いている場所は必ず外せるようにする**。
   * 外せないと、一覧の取得が失敗している間ずっと参照画像が渡り続け、
   * 利用者には取り消す手段が画面上に存在しない状態になる。
   *
   * **これは削除ではない。** 外れるのは Shot との関連づけだけで、
   * ロケーション自体は残る。だから `WORDING.unlink` を使い、`danger` も使わない。
   */
  const removable = !selectable && locationId !== null
  const unchanged = draft === toLocationFieldValue(locationId)
  const busy = saving || disabled

  const save = (): void => {
    const patch = toLocationPatch(draft)
    if (!patch.ok) {
      setInvalid(patch.message)
      return
    }

    setInvalid(undefined)
    onSave(patch.locationId)
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-6 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-text">ロケーション</h2>

      <LocationField
        locations={locations}
        value={draft}
        disabled={busy}
        error={invalid}
        loadError={loadError}
        onChange={(value) => {
          setDraft(value)
        }}
      />

      {(selectable || removable) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {selectable ? (
            <Button tone="primary" disabled={busy || unchanged} onClick={save}>
              {saving ? '保存中…' : `ロケーションを${WORDING.save}`}
            </Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() => {
                setInvalid(undefined)
                onSave(null)
              }}
            >
              {saving ? '保存中…' : `ロケーションを${WORDING.unlink}`}
            </Button>
          )}
          {removable && (
            <p className="text-xs text-muted">
              ロケーション自体は残ります。この Shot との関連づけだけを外します。
            </p>
          )}
          {feedback !== null && (
            <p
              role={feedback.tone === 'error' ? 'alert' : 'status'}
              className={`text-sm ${FEEDBACK_CLASS[feedback.tone]}`}
            >
              {feedback.message}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
