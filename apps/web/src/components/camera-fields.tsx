import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import {
  ANGLE_HORIZONTAL_OPTIONS,
  ANGLE_VERTICAL_OPTIONS,
  CAMERA_MOVEMENT_OPTIONS,
  MOVEMENT_INTENSITY_OPTIONS,
  SHOT_SIZE_OPTIONS,
} from '@/lib/camera-options'
import type { ShotFormErrors, ShotFormValues } from '@/lib/shot-form'

/** カメラ指定の入力欄。選択肢はすべて `@ixa/domain` の enum から生成される。 */
export type CameraField = 'size' | 'angleH' | 'angle' | 'lensMm' | 'movement' | 'movementIntensity'

export type CameraFieldsProps = {
  readonly values: ShotFormValues
  readonly errors: ShotFormErrors
  readonly disabled: boolean
  readonly onChange: (field: CameraField, value: string) => void
}

export const CameraFields = ({ values, errors, disabled, onChange }: CameraFieldsProps) => (
  <fieldset className="rounded-md border border-slate-200 p-4">
    <legend className="px-1 text-sm font-semibold text-slate-800">カメラ</legend>
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id="size"
        label="景別"
        value={values.size}
        options={SHOT_SIZE_OPTIONS}
        disabled={disabled}
        error={errors.size}
        onChange={(value) => {
          onChange('size', value)
        }}
      />
      <SelectField
        id="angleH"
        label="水平位置"
        value={values.angleH}
        options={ANGLE_HORIZONTAL_OPTIONS}
        disabled={disabled}
        error={errors.angleH}
        onChange={(value) => {
          onChange('angleH', value)
        }}
      />
      <SelectField
        id="angle"
        label="俯仰"
        value={values.angle}
        options={ANGLE_VERTICAL_OPTIONS}
        disabled={disabled}
        error={errors.angle}
        onChange={(value) => {
          onChange('angle', value)
        }}
      />
      <TextField
        id="lensMm"
        label="レンズ (mm)"
        value={values.lensMm}
        placeholder="35"
        disabled={disabled}
        error={errors.lensMm}
        onChange={(value) => {
          onChange('lensMm', value)
        }}
      />
      <SelectField
        id="movement"
        label="カメラの動き"
        value={values.movement}
        options={CAMERA_MOVEMENT_OPTIONS}
        disabled={disabled}
        error={errors.movement}
        onChange={(value) => {
          onChange('movement', value)
        }}
      />
      <SelectField
        id="movementIntensity"
        label="動きの強度"
        value={values.movementIntensity}
        options={MOVEMENT_INTENSITY_OPTIONS}
        disabled={disabled}
        error={errors.movementIntensity}
        onChange={(value) => {
          onChange('movementIntensity', value)
        }}
      />
    </div>
  </fieldset>
)
