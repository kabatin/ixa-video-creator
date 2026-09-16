import { FieldError } from '@/components/form/field-error'

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
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
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
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
      />
      <FieldError id={errorId} message={error} />
    </div>
  )
}
