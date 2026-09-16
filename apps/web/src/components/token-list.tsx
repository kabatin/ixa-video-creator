export type TokenListProps = {
  readonly label: string
  readonly tokens: readonly string[]
}

/** プロンプト断片の配列を読める形で出す。空であることも明示する。 */
export const TokenList = ({ label, tokens }: TokenListProps) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className="mt-1 flex flex-wrap gap-1">
      {tokens.length === 0 ? (
        <span className="text-sm text-slate-400">未登録</span>
      ) : (
        tokens.map((token) => (
          <span key={token} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {token}
          </span>
        ))
      )}
    </dd>
  </div>
)
