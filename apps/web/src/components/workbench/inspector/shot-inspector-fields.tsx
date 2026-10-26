'use client'

import { LocationId, ShotCamera, type Shot, type Take } from '@ixa/domain'
import { ReviewPanel } from '@/components/review-panel'
import { useAssets } from '@/components/workbench/asset-store'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveCheckbox, AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import type { useWorkbench } from '@/components/workbench/workbench-context'
import {
  ANGLE_HORIZONTAL_OPTIONS,
  ANGLE_VERTICAL_OPTIONS,
  CAMERA_MOVEMENT_OPTIONS,
  MOVEMENT_INTENSITY_OPTIONS,
  NONE_VALUE,
  SHOT_SIZE_OPTIONS,
} from '@/lib/camera-options'
import { formatClock, formatDuration } from '@/lib/format-time'
import { parseClockInput, parseDurationInput } from '@/lib/time-input'

/**
 * Shot のインスペクターの小さな欄（参照のロケーション・時間・詳しい設定・レビュー）。
 * 並べ方は `shot-inspector.tsx`、区切りの名前と要約は `lib/shot-inspector-sections.ts`。
 */

export type SaveShot = (patch: Parameters<ReturnType<typeof useWorkbench>['saveShot']>[1]) => Promise<void>

/** カメラは 1 行ずつの選択に畳む（以前は 5 つの大きな欄）。選んだ時点で保存する。 */
export const CameraFields = ({
  shot,
  disabled,
  onSave,
}: {
  readonly shot: Shot
  readonly disabled: boolean
  readonly onSave: SaveShot
}) => {
  const saveCamera = async (
    patch: Partial<Record<keyof Shot['camera'], string | null>>,
  ): Promise<void> => {
    await onSave({ camera: ShotCamera.parse({ ...shot.camera, ...patch }) })
  }
  const orNull = (value: string): string | null => (value === NONE_VALUE ? null : value)
  return (
    <>
      <AutoSaveSelect
        label="景別"
        value={shot.camera.size}
        options={SHOT_SIZE_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ size: next })}
      />
      <AutoSaveSelect
        label="向き"
        value={shot.camera.angleH ?? NONE_VALUE}
        options={ANGLE_HORIZONTAL_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ angleH: orNull(next) })}
      />
      <AutoSaveSelect
        label="高さ"
        value={shot.camera.angle ?? NONE_VALUE}
        options={ANGLE_VERTICAL_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ angle: orNull(next) })}
      />
      <AutoSaveSelect
        label="動き"
        value={shot.camera.movement ?? NONE_VALUE}
        options={CAMERA_MOVEMENT_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ movement: orNull(next) })}
      />
      <AutoSaveSelect
        label="動きの強さ"
        value={shot.camera.movementIntensity ?? NONE_VALUE}
        options={MOVEMENT_INTENSITY_OPTIONS}
        disabled={disabled}
        onSave={(next) => saveCamera({ movementIntensity: orNull(next) })}
      />
      <AutoSaveField
        label="レンズ"
        value={shot.camera.lensMm === null ? '' : `${String(shot.camera.lensMm)}mm`}
        placeholder="35mm"
        disabled={disabled}
        validate={(next) =>
          next.trim() === '' || /^\d+(\.\d+)?\s*(mm)?$/i.test(next.trim())
            ? null
            : '35mm のように入れてください'
        }
        onSave={async (next) => {
          const mm = next.trim() === '' ? null : Number.parseFloat(next)
          await onSave({ camera: ShotCamera.parse({ ...shot.camera, lensMm: mm }) })
        }}
      />
    </>
  )
}

/** ロケーション。選択肢は素材の共有状態から（ツリーで足したものがすぐ出る）。 */
export const LocationField = ({
  shot,
  disabled,
  onSave,
}: {
  readonly shot: Shot
  readonly disabled: boolean
  readonly onSave: SaveShot
}) => {
  const { locations } = useAssets()
  const options = [
    { value: '', label: 'なし' },
    ...(locations.state === 'ready' ? locations.value : []).map((location) => ({
      value: location.id,
      label: location.name,
    })),
  ]
  return (
    <>
      <AutoSaveSelect
        label="ロケーション"
        value={shot.locationId ?? ''}
        options={options}
        disabled={disabled || locations.state !== 'ready'}
        onSave={(next) => onSave({ locationId: next === '' ? null : LocationId.parse(next) })}
      />
      {locations.state === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {locations.message}
        </p>
      )}
    </>
  )
}

/** 時間（コード・開始・尺）。数字は `0:02.67` / `1.97s` で出し、同じ形で受ける（§5.1）。 */
export const TimeFields = ({
  shot,
  disabled,
  onSave,
}: {
  readonly shot: Shot
  readonly disabled: boolean
  readonly onSave: SaveShot
}) => (
  <>
    <AutoSaveField
      label="コード"
      value={shot.code}
      disabled={disabled}
      validate={(next) => (next.trim() === '' ? 'コードを入れてください' : null)}
      onSave={(next) => onSave({ code: next.trim() })}
    />
    <AutoSaveField
      label="開始"
      value={formatClock(shot.startSec)}
      disabled={disabled}
      validate={(next) => (parseClockInput(next) === null ? '0:12.34 か 12.34 の形で入れてください' : null)}
      onSave={(next) => onSave({ startSec: parseClockInput(next) ?? shot.startSec })}
    />
    <AutoSaveField
      label="尺"
      value={formatDuration(shot.durationSec)}
      disabled={disabled}
      validate={(next) =>
        parseDurationInput(next) === null ? '1.50s のように 0 より大きい秒で入れてください' : null
      }
      onSave={(next) => onSave({ durationSec: parseDurationInput(next) ?? shot.durationSec })}
    />
  </>
)

/** 詳しい設定（カメラと、前の Shot から画を繋ぐか）。普段触らないので畳んだ区切りに置く。 */
export const DetailFields = ({
  shot,
  isFirst,
  disabled,
  onSave,
}: {
  readonly shot: Shot
  readonly isFirst: boolean
  readonly disabled: boolean
  readonly onSave: SaveShot
}) => (
  <>
    <CameraFields shot={shot} disabled={disabled} onSave={onSave} />
    <AutoSaveCheckbox
      label="前の Shot から画を繋ぐ"
      checked={!isFirst && shot.continuityMode === 'previous_shot'}
      disabled={isFirst || disabled}
      hint={
        isFirst
          ? '先頭の Shot には前のカットがありません。'
          : '前の採用 Take の最終フレームを開始画像にします。境界で約 1 フレーム止まって見える場合があります。'
      }
      onSave={(next) => onSave({ continuityMode: next ? 'previous_shot' : 'independent' })}
    />
  </>
)

/** レビュー。採用中の Take に対して行う。 */
export const ReviewBody = ({ shot, adopted }: { readonly shot: Shot; readonly adopted: Take | null }) =>
  adopted === null ? (
    <p className="text-sm text-muted">採用している Take がありません。Take 比較で採用するとレビューできます。</p>
  ) : (
    <ReviewPanel shotId={shot.id} takeId={adopted.id} />
  )
