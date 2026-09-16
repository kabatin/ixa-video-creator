export type ErrorPanelProps = {
  readonly title: string
  readonly message: string
  readonly hint?: string
}

/** API 障害・設定不足を白画面にせず、原因が分かる形で表示する。 */
export const ErrorPanel = ({ title, message, hint }: ErrorPanelProps) => (
  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6">
    <h2 className="text-base font-semibold text-red-900">{title}</h2>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-red-800">{message}</p>
    {hint !== undefined && <p className="mt-3 text-sm text-red-700">{hint}</p>}
  </div>
)
