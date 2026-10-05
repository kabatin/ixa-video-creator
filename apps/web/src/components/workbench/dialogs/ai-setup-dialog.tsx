'use client'

import { AI_TOOLS, AiPurpose, type AiSettings } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { describeForPerson } from '@/lib/api-error'
import { createApiClient } from '@/lib/api-client'
import type { AiSettingsApi, WireAiTools } from '@/lib/ai-settings-api'
import { aiOptionsFor, initialAiChoice } from '@/lib/ai-setup'
import { fieldErrorsOf, type ServerFieldErrors } from '@/lib/library-api'

/** 用途の見出しと、何に使うか。 */
const PURPOSES: Readonly<Record<AiPurpose, { readonly title: string; readonly hint: string }>> = {
  text: { title: 'テキスト', hint: '絵コンテの案（各 Shot の説明の下書き）' },
  image: { title: '画像', hint: 'Shot の絵（最初のフレーム）' },
  video: { title: '動画', hint: 'Shot の映像。AUTO はこの AI のモデルから選びます' },
  voice: { title: '声', hint: 'ナレーション・セリフを読む' },
  transcribe: { title: '文字起こし', hint: '録音したナレーションを聞き取って、行とテロップにする' },
}

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly tools: WireAiTools; readonly choice: AiSettings }
  | { readonly kind: 'error'; readonly message: string }

const PurposeGroup = ({
  purpose,
  tools,
  chosen,
  error,
  onChoose,
}: {
  readonly purpose: AiPurpose
  readonly tools: WireAiTools
  readonly chosen: AiSettings[AiPurpose]
  readonly error: string | undefined
  readonly onChoose: (id: AiSettings[AiPurpose]) => void
}) => {
  const { options, installedButUnsupported } = aiOptionsFor(purpose, tools.tools)
  const titleId = `ai-setup-${purpose}`
  return (
    <fieldset role="radiogroup" aria-labelledby={titleId} className="space-y-1">
      <legend id={titleId} className="text-sm font-semibold text-text">
        {PURPOSES[purpose].title}
        <span className="ml-2 text-xs font-normal text-muted">{PURPOSES[purpose].hint}</span>
      </legend>
      {options.map((option) => (
        <label key={option.id} className="flex items-start gap-2 text-sm text-text">
          <input
            type="radio"
            name={titleId}
            value={option.id}
            checked={chosen === option.id}
            disabled={option.problem !== null}
            onChange={() => {
              onChoose(option.id)
            }}
            className="mt-1"
          />
          <span className={option.problem === null ? '' : 'text-muted'}>
            {option.version === null ? option.label : `${option.label} ${option.version}`}
            {option.problem !== null && <span className="block text-xs">{option.problem}</span>}
            {/* 原稿が外に出る・お金が掛かる AI は、選ぶ前に知っておくことを見せる（ADR-0038）。 */}
            {option.notice !== null && <span className="block text-xs text-warn">{option.notice}</span>}
          </span>
        </label>
      ))}
      {installedButUnsupported.length > 0 && (
        <p className="text-xs text-muted">
          {`${installedButUnsupported.map((id) => AI_TOOLS[id].label).join('・')} は${PURPOSES[purpose].title}には使えません（入っていますが、まだ繋いでいません）`}
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/**
 * 使う AI を選ぶ（ADR-0032）。この Mac で見つかった AI から、用途ごとに 1 つ。
 * 初めてワークベンチを開いたときに 1 度だけ出し、あとはメニュー「使う AI…」から開く。
 * **API キーは扱わない**（`.env` のまま。規約 6）。
 */
export const AiSetupDialogBody = ({ api }: { readonly api?: AiSettingsApi }) => {
  const workbench = useWorkbench()
  const client = useMemo<AiSettingsApi>(() => api ?? createApiClient(), [api])
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<ServerFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([client.listAiTools(), client.getAiSettings()])
      .then(([tools, state]) => {
        if (alive)
          setLoaded({ kind: 'ready', tools, choice: initialAiChoice(state, tools.recommended) })
      })
      .catch((cause: unknown) => {
        if (alive) setLoaded({ kind: 'error', message: describeForPerson(cause) })
      })
    return () => {
      alive = false
    }
  }, [client])

  if (loaded.kind === 'loading') {
    return <p className="text-sm text-muted">この Mac の AI を探しています…（数秒かかります）</p>
  }
  if (loaded.kind === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        {`使える AI を調べられませんでした: ${loaded.message}`}
      </p>
    )
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      await client.saveAiSettings(loaded.choice)
      workbench.closeDialog()
    } catch (cause) {
      const fields = fieldErrorsOf(cause)
      if (fields === null) setFormError(`保存できませんでした: ${describeForPerson(cause)}`)
      else setErrors(fields)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        この Mac で見つかった AI から、用途ごとに 1 つ選びます。あとからメニュー「使う
        AI…」で変えられます。
      </p>
      {AiPurpose.options.map((purpose) => (
        <PurposeGroup
          key={purpose}
          purpose={purpose}
          tools={loaded.tools}
          chosen={loaded.choice[purpose]}
          error={errors[purpose]}
          onChoose={(id) => {
            setLoaded({ ...loaded, choice: { ...loaded.choice, [purpose]: id } })
          }}
        />
      ))}
      {formError !== null && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={workbench.closeDialog}>
          あとで
        </Button>
        <Button size="sm" tone="primary" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : 'この設定で使う'}
        </Button>
      </div>
    </div>
  )
}
