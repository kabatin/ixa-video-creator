import { FieldError } from '@/components/form/field-error'
import { FIELD_CONTROL_CLASS, FIELD_LABEL_CLASS } from '@/components/form/field-styles'

export type TextFieldProps = {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly error?: string
  readonly disabled?: boolean
  readonly placeholder?: string
}

export const TextField = ({
  id,
  label,
  value,
  onChange,
  error,
  disabled = false,
  placeholder,
}: TextFieldProps) => {
  const errorId = `${id}-error`
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={`mt-1 ${FIELD_CONTROL_CLASS}`}
      />
      <FieldError id={errorId} message={error} />
    </div>
  )
}
