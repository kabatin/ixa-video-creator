'use client'

import type { AiCheckTarget, AiChecks, AiToolId } from '@ixa/domain'

/**
 * AI のチェック（ADR-0066）の切り替え。「使う AI」の画面の下に置く。**既定は切る**
 * （制作者 2026-10-28「トークン消費激しすぎる」）。入れると Claude の利用枠を 1 枚・1 本ごとに使う。
 * 働くのはテキストの AI が Claude のときだけ（規則は domain の `aiCheckGate`）。
 */
const SWITCHES: Readonly<Record<AiCheckTarget, { readonly title: string; readonly hint: string }>> = {
  image: {
    title: '描いた絵をチェックする',
    hint: '最初のフレーム・キャラクターシート・キーアートを 1 枚描くごとに Claude の利用枠を使います。崩れていれば描き直します。',
  },
  video: {
    title: 'Take をチェックする',
    hint: 'レビューのたびに、Take 1 本ごとに Claude の利用枠を使います。切っている間も、Claude を使わない点検は行います。',
  },
}

const TARGETS: readonly AiCheckTarget[] = ['image', 'video']

export const AiCheckSwitches = ({
  checks,
  text,
  onChange,
}: {
  readonly checks: AiChecks
  /** いま選んでいるテキストの AI。Claude でなければ、入れても働かないことを言う。 */
  readonly text: AiToolId
  readonly onChange: (checks: AiChecks) => void
}) => (
  <fieldset className="space-y-1.5 border-t border-border pt-3">
    <legend className="text-sm font-semibold text-text">Claude のチェック</legend>
    <p className="text-xs text-muted">
      {text === 'claude_cli'
        ? '入れると、Claude が見て確かめます。'
        : 'テキストの AI が Claude のときだけ働きます（いまは入れても働きません）。'}
    </p>
    {TARGETS.map((target) => (
      <label key={target} className="flex items-start gap-2 rounded px-2 py-1.5 text-sm text-text hover:bg-surface-2">
        <input
          type="checkbox"
          role="switch"
          checked={checks[target]}
          aria-describedby={`ai-check-${target}-hint`}
          onChange={(event) => {
            onChange({ ...checks, [target]: event.target.checked })
          }}
          className="mt-1"
        />
        <span className="min-w-0">
          <span className="block">{SWITCHES[target].title}</span>
          <span id={`ai-check-${target}-hint`} className="block text-xs text-muted">
            {SWITCHES[target].hint}
          </span>
        </span>
      </label>
    ))}
  </fieldset>
)
