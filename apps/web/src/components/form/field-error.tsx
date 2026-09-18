export type FieldErrorProps = {
  readonly id: string
  readonly message?: string
}

/** エラーは必ず入力欄の直下に出す。aria-describedby で入力欄と結び付ける。 */
export const FieldError = ({ id, message }: FieldErrorProps) =>
  message === undefined ? null : (
    <p id={id} role="alert" className="mt-1 text-sm text-danger">
      {message}
    </p>
  )
