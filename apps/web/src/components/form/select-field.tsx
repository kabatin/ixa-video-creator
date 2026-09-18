import { FieldError } from '@/components/form/field-error'
import { FIELD_CONTROL_CLASS, FIELD_LABEL_CLASS } from '@/components/form/field-styles'

export type SelectOption = {
  readonly value: string
  readonly label: string
}

export type SelectFieldProps = {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly options: readonly SelectOption[]
  readonly onChange: (value: string) => void
  readonly error?: string
  readonly disabled?: boolean
}

export const SelectField = ({
  id,
  label,
  value,
  options,
  onChange,
  error,
  disabled = false,
}: SelectFieldProps) => {
  const errorId = `${id}-error`
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={`mt-1 bg-surface ${FIELD_CONTROL_CLASS}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError id={errorId} message={error} />
    </div>
  )
}
