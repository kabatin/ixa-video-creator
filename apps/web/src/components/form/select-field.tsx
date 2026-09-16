import { FieldError } from '@/components/form/field-error'

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
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
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
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
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
