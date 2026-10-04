import type { RenderRejection } from '@/lib/render-api'
import { summarizeReasons } from '@/lib/render-display'

/** 書き出しを断られた理由。フィールドごとに件数を残したまま、先頭だけ出す。72 件を全部並べても読めない。 */
export const RenderRejected = ({ rejection }: { readonly rejection: RenderRejection }) => {
  const entries = Object.entries(rejection.fields)
  return (
    <section role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3">
      <h4 className="text-sm font-semibold text-danger">{`書き出しを受け付けられませんでした: ${rejection.message}`}</h4>
      {entries.length === 0 && (
        <p className="mt-1 text-sm text-danger">理由が分かりませんでした。もう一度書き出すと直ることがあります。</p>
      )}
      {entries.map(([field, reasons]) => {
        const summary = summarizeReasons(reasons)
        return (
          <div key={field} className="mt-2">
            <p className="text-sm font-medium text-danger">{`${field}: ${String(summary.total)} 件`}</p>
            <ul className="mt-1 flex flex-col gap-0.5 pl-4 text-xs text-danger">
              {summary.shown.map((reason) => (
                <li key={reason} className="list-disc break-words">
                  {reason}
                </li>
              ))}
              {summary.hiddenCount > 0 && <li className="list-none">{`ほか ${String(summary.hiddenCount)} 件`}</li>}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
