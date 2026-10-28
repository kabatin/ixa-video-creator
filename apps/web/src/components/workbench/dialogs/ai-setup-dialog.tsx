'use client'

import { AI_TOOLS, AiPurpose, type AiSettings } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { describeForPerson } from '@/lib/api-error'
import { createApiClient } from '@/lib/api-client'
import type { AiSettingsApi, WireAiTools } from '@/lib/ai-settings-api'
import { AiCheckSwitches } from '@/components/workbench/dialogs/ai-check-switches'
import { aiOptionsFor, initialAiChoice, type AiOption } from '@/lib/ai-setup'
import { fieldErrorsOf, type ServerFieldErrors } from '@/lib/library-api'

/** 用途の見出しと、何に使うか。 */
const PURPOSES: Readonly<Record<AiPurpose, { readonly title: string; readonly hint: string }>> = {
  text: { title: 'テキスト', hint: '絵コンテの案を書く' },
  image: { title: '画像', hint: 'Shot の最初の絵を描く' },
  video: { title: '動画', hint: 'Shot の映像を作る。AUTO はこの AI のモデルから選びます' },
  voice: { title: '声', hint: 'ナレーション・セリフを読む' },
  transcribe: { title: '文字起こし', hint: '録音を聞き取って、行とテロップにする' },
  music: { title: '曲', hint: '曲調と歌詞から楽曲を作る' },
  sfx: { title: '効果音', hint: '説明（英語）から効果音を作り、効果音の段に置く' },
}

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly tools: WireAiTools; readonly choice: AiSettings }
  | { readonly kind: 'error'; readonly message: string }

const tabId = (purpose: AiPurpose): string => `ai-setup-${purpose}`

const OptionRow = ({
  option,
  name,
  checked,
  onChoose,
}: {
  readonly option: AiOption
  readonly name: string
  readonly checked: boolean
  readonly onChoose: () => void
}) => (
  <label className="flex items-start gap-2 rounded px-2 py-1.5 text-sm text-text hover:bg-surface-2">
    <input
      type="radio"
      name={name}
      value={option.id}
      checked={checked}
      disabled={option.problem !== null}
      onChange={onChoose}
      className="mt-1"
    />
    <span className={`min-w-0 ${option.problem === null ? '' : 'text-muted'}`}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{option.label}</span>
        {option.version !== null && <span className="text-xs text-muted">{option.version}</span>}
        {option.tags.map((tag) => (
          <span key={tag} className="rounded border border-border px-1.5 text-xs text-muted">
            {tag}
          </span>
        ))}
      </span>
      {option.problem !== null && <span className="block text-xs">{option.problem}</span>}
      {/* 原稿が外に出る・お金が掛かる AI は、選ぶ前に知っておくことを見せる（ADR-0038）。 */}
      {option.notice !== null && <span className="block text-xs text-warn">{option.notice}</span>}
    </span>
  </label>
)

const PurposePanel = ({
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
}) => (
  <div
    id={`${tabId(purpose)}-panel`}
    role="tabpanel"
    aria-labelledby={tabId(purpose)}
    className="min-w-0 flex-1 space-y-2"
  >
    <p className="text-xs text-muted">{PURPOSES[purpose].hint}</p>
    <fieldset role="radiogroup" aria-label={PURPOSES[purpose].title} className="space-y-0.5">
      {aiOptionsFor(purpose, tools.tools).map((option) => (
        <OptionRow
          key={option.id}
          option={option}
          name={tabId(purpose)}
          checked={chosen === option.id}
          onChoose={() => {
            onChoose(option.id)
          }}
        />
      ))}
      {error !== undefined && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  </div>
)

const PurposeTabs = ({
  current,
  choice,
  tools,
  errors,
  onSelect,
}: {
  readonly current: AiPurpose
  readonly choice: AiSettings
  readonly tools: WireAiTools
  readonly errors: ServerFieldErrors
  readonly onSelect: (purpose: AiPurpose) => void
}) => (
  <div role="tablist" aria-orientation="vertical" aria-label="用途" className="w-40 shrink-0 space-y-0.5">
    {AiPurpose.options.map((purpose) => {
      const selected = purpose === current
      const chosenLabel = tools.tools.find((tool) => tool.id === choice[purpose])?.label ?? AI_TOOLS[choice[purpose]].label
      return (
        <button
          key={purpose}
          id={tabId(purpose)}
          type="button"
          role="tab"
          aria-selected={selected}
          aria-controls={`${tabId(purpose)}-panel`}
          onClick={() => {
            onSelect(purpose)
          }}
          className={`block w-full rounded px-2 py-1 text-left ${
            selected ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
          }`}
        >
          <span className={`block text-sm ${selected ? 'font-semibold' : ''}`}>
            {PURPOSES[purpose].title}
            {errors[purpose] !== undefined && <span className="ml-1 text-danger">！</span>}
          </span>
          <span className="block truncate text-xs text-muted">{chosenLabel}</span>
        </button>
      )
    })}
  </div>
)

/**
 * 使う AI を選ぶ（ADR-0032）。この Mac で見つかった AI から、用途ごとに 1 つ。用途は左のタブで切り替える。
 * 初めてワークベンチを開いたときに 1 度だけ出し、あとはメニュー「使う AI…」から開く。
 * **API キーは扱わない**（`.env` のまま。規約 6）。
 */
export const AiSetupDialogBody = ({ api }: { readonly api?: AiSettingsApi }) => {
  const workbench = useWorkbench()
  const client = useMemo<AiSettingsApi>(() => api ?? createApiClient(), [api])
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [purpose, setPurpose] = useState<AiPurpose>('text')
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
      else {
        setErrors(fields)
        // 理由のある用途を開いて見せる（ほかのタブに隠さない）。
        const first = AiPurpose.options.find((value) => fields[value] !== undefined)
        if (first !== undefined) setPurpose(first)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">用途ごとに、この Mac で使える AI から 1 つ選びます。</p>
      <div className="flex min-h-72 gap-4">
        <PurposeTabs
          current={purpose}
          choice={loaded.choice}
          tools={loaded.tools}
          errors={errors}
          onSelect={setPurpose}
        />
        <PurposePanel
          purpose={purpose}
          tools={loaded.tools}
          chosen={loaded.choice[purpose]}
          error={errors[purpose]}
          onChoose={(id) => {
            setLoaded({ ...loaded, choice: { ...loaded.choice, [purpose]: id } })
          }}
        />
      </div>
      <AiCheckSwitches
        checks={loaded.choice.checks}
        text={loaded.choice.text}
        onChange={(checks) => {
          setLoaded({ ...loaded, choice: { ...loaded.choice, checks } })
        }}
      />
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
