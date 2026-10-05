'use client'

import {
  AI_TOOLS,
  CharacterId,
  MediaAssetId,
  TextStyleId,
  VOICE_SPEED_MAX,
  VOICE_SPEED_MIN,
  VoiceJobId,
  VoiceToolId,
  type UpdateVoiceProfilePatch,
  type VoiceProfileId,
} from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { MenuButton } from '@/components/workbench/ui/more-menu'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
import { useAssetMenu } from '@/components/workbench/use-asset-menu'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { WireVoiceOptions } from '@/lib/narration-api'
import type { WireTextStylePreset } from '@/lib/text-style-api'
import { VOICE_TOOL_LABELS } from '@/lib/voice-defaults'

/**
 * 声のインスペクター（ADR-0038）。使う AI・声の種類・声のイメージ・速さ、誰の声か、テロップの見た目。
 * 「試しに読む」は好きな一文で試聴する（作った音はジョブに残るので、同じ文をもう一度押しても作り直さない）。
 */

const PREVIEW_TEXT = 'こんにちは。これは試しに読む声です。'
const NONE = ''

type Options = { readonly state: 'loading' } | { readonly state: 'ready'; readonly value: WireVoiceOptions } | { readonly state: 'error'; readonly message: string }

const useVoiceOptions = (tool: VoiceToolId, language: string): Options => {
  const api = useMemo(() => createApiClient(), [])
  const [options, setOptions] = useState<Options>({ state: 'loading' })
  useEffect(() => {
    let cancelled = false
    setOptions({ state: 'loading' })
    api
      .voiceOptions(tool, language)
      .then((value) => {
        if (!cancelled) setOptions({ state: 'ready', value })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setOptions({ state: 'error', message: `声の一覧を出せません: ${describeForPerson(cause)}` })
      })
    return () => {
      cancelled = true
    }
  }, [api, tool, language])
  return options
}

export const VoiceInspector = ({ id }: { readonly id: VoiceProfileId }) => {
  const assetMenu = useAssetMenu()
  const workbench = useWorkbench()
  const { voices, characters, actions } = useAssets()
  const api = useMemo(() => createApiClient(), [])
  const voice = readyOr(voices).find((item) => item.id === id)
  const options = useVoiceOptions(voice?.tool ?? 'stub', voice?.language ?? 'ja')
  const [styles, setStyles] = useState<readonly WireTextStylePreset[]>([])

  useEffect(() => {
    let cancelled = false
    api
      .listTextStyles(workbench.projectId)
      .then((loaded) => {
        if (!cancelled) setStyles(loaded)
      })
      .catch(() => {
        // 見た目の一覧が読めなくても、ほかの欄は直せる（選択肢が「既定」だけになる）。
        if (!cancelled) setStyles([])
      })
    return () => {
      cancelled = true
    }
  }, [api, workbench.projectId])

  if (voice === undefined) {
    return <PanelEmpty title="この声は見つかりません" hint="消されたか、まだ読み込めていません。" />
  }

  const save = async (patch: UpdateVoiceProfilePatch): Promise<void> => {
    await actions.updateVoice(id, patch)
  }
  /** AI を替えると声の種類の意味が変わる。その AI の最初の声とモデルに揃える。 */
  const switchTool = async (next: string): Promise<void> => {
    const tool = VoiceToolId.parse(next)
    const list = await api.voiceOptions(tool, voice.language)
    const first = list.voices[0]
    if (first === undefined) throw new Error('この AI で選べる声がありません')
    await save({ tool, voiceName: first.id, model: list.models[0]?.id ?? null })
  }
  const notice = AI_TOOLS[voice.tool].notice

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader
        kind="声"
        title={voice.name}
        menu={
          <MenuButton
            label={`${voice.name} のその他の操作`}
            items={assetMenu.itemsFor({ kind: 'voice', id }, 'inspector') ?? []}
          />
        }
      />
      <div className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">
        <Section title="声">
          <AutoSaveField
            label="名前"
            value={voice.name}
            validate={(next) => (next.trim() === '' ? '名前を入れてください' : null)}
            onSave={(next) => save({ name: next.trim() })}
          />
          <AutoSaveSelect
            label="使う AI"
            value={voice.tool}
            options={VoiceToolId.options.map((tool) => ({ value: tool, label: VOICE_TOOL_LABELS[tool] }))}
            onSave={switchTool}
          />
          {notice !== null && <p className="text-xs text-warn">{notice}</p>}
          {options.state === 'error' && <p className="text-xs text-danger">{options.message}</p>}
          {options.state === 'ready' && options.value.models.length > 0 && (
            <AutoSaveSelect
              label="モデル"
              value={voice.model ?? options.value.models[0]?.id ?? NONE}
              options={options.value.models.map((model) => ({ value: model.id, label: model.label }))}
              onSave={(next) => save({ model: next })}
            />
          )}
          {options.state === 'ready' && (
            <AutoSaveSelect
              label="声の種類"
              value={voice.voiceName}
              options={withCurrent(
                options.value.voices.map((option) => ({
                  value: option.id,
                  label: option.note === null ? option.label : `${option.label}（${option.note}）`,
                })),
                voice.voiceName,
              )}
              onSave={(next) => save({ voiceName: next })}
            />
          )}
          <AutoSaveField
            label="声のイメージ"
            multiline
            value={voice.styleNote}
            placeholder="落ち着いた低めの声。映画の予告編のように、ゆっくり重く"
            onSave={(next) => save({ styleNote: next })}
          />
          {voice.tool === 'macos_say' && <p className="text-xs text-muted">Mac の声は声のイメージを使いません。</p>}
          <AutoSaveField
            label="速さ"
            value={String(voice.speed)}
            validate={(next) => {
              const value = Number.parseFloat(next)
              return Number.isFinite(value) && value >= VOICE_SPEED_MIN && value <= VOICE_SPEED_MAX
                ? null
                : `${String(VOICE_SPEED_MIN)}〜${String(VOICE_SPEED_MAX)} で入れてください`
            }}
            onSave={(next) => save({ speed: Number.parseFloat(next) })}
          />
          <AutoSaveField
            label="音量"
            value={`${String(Math.round(voice.volume * 100))}%`}
            validate={(next) => {
              const value = Number.parseFloat(next)
              return Number.isFinite(value) && value >= 0 && value <= 200 ? null : '0〜200% で入れてください'
            }}
            onSave={(next) => save({ volume: Number.parseFloat(next) / 100 })}
          />
          <p className="text-xs text-muted">速さ・声の種類・声のイメージを変えると、その声で話す行は作り直しが要ります。</p>
        </Section>
        <Section title="誰の声か・テロップ">
          <AutoSaveSelect
            label="キャラクター"
            value={voice.characterId ?? NONE}
            options={[
              { value: NONE, label: 'なし（ナレーターなど）' },
              ...readyOr(characters).map((character) => ({ value: character.id, label: character.displayName })),
            ]}
            onSave={(next) => save({ characterId: next === NONE ? null : CharacterId.parse(next) })}
          />
          <AutoSaveSelect
            label="テロップの見た目"
            value={voice.textStyleId ?? NONE}
            options={[
              { value: NONE, label: '「ナレーション」の見た目（既定）' },
              ...styles.map((style) => ({ value: style.id, label: style.name })),
            ]}
            onSave={async (next) => {
              await save({ textStyleId: next === NONE ? null : TextStyleId.parse(next) })
              // この声の行のテロップは、サーバで新しい見た目に当て直されている。
              workbench.bumpNarration()
            }}
          />
        </Section>
        <Section title="試しに読む">
          <VoicePreview voiceId={id} />
        </Section>
      </div>
    </div>
  )
}

/** いまの値が一覧に無い（AI の一覧が変わった）ときも、選べなくならないよう末尾に足す。 */
const withCurrent = (
  options: readonly { readonly value: string; readonly label: string }[],
  current: string,
): readonly { readonly value: string; readonly label: string }[] =>
  options.some((option) => option.value === current) ? options : [...options, { value: current, label: current }]

type Preview =
  | { readonly state: 'idle' }
  | { readonly state: 'waiting'; readonly jobId: VoiceJobId }
  | { readonly state: 'ready'; readonly url: string }
  | { readonly state: 'error'; readonly message: string }

/** 好きな一文で試聴する。できたかは声のジョブの出来事（narrationEpoch）で確かめ直す。 */
const VoicePreview = ({ voiceId }: { readonly voiceId: VoiceProfileId }) => {
  const api = useMemo(() => createApiClient(), [])
  const { narrationEpoch } = useWorkbench()
  const [text, setText] = useState(PREVIEW_TEXT)
  const [preview, setPreview] = useState<Preview>({ state: 'idle' })
  const waitingFor = preview.state === 'waiting' ? preview.jobId : null

  useEffect(() => {
    if (waitingFor === null) return undefined
    let cancelled = false
    const check = async (): Promise<void> => {
      const job = await api.getVoiceJob(waitingFor)
      if (cancelled) return
      if (job.status === 'failed' || job.status === 'cancelled') {
        setPreview({ state: 'error', message: job.error ?? '試しに読めませんでした' })
        return
      }
      if (job.status !== 'succeeded' || job.resultMediaAssetId === null) return
      const signed = await api.mediaUrl(MediaAssetId.parse(job.resultMediaAssetId))
      if (!cancelled) setPreview({ state: 'ready', url: signed.url })
    }
    check().catch((cause: unknown) => {
      if (!cancelled) setPreview({ state: 'error', message: describeForPerson(cause) })
    })
    return () => {
      cancelled = true
    }
  }, [api, waitingFor, narrationEpoch])

  const start = (): void => {
    setPreview({ state: 'idle' })
    api
      .previewVoice(voiceId, text)
      .then(({ jobId }) => {
        setPreview({ state: 'waiting', jobId: VoiceJobId.parse(jobId) })
      })
      .catch((cause: unknown) => {
        setPreview({ state: 'error', message: describeForPerson(cause) })
      })
  }

  return (
    <div className="space-y-2">
      <textarea
        aria-label="試しに読む文"
        value={text}
        maxLength={200}
        rows={2}
        onChange={(event) => {
          setText(event.target.value)
        }}
        className="w-full rounded border border-line-strong bg-bg px-2 py-1 text-sm text-text"
      />
      <Button size="sm" disabled={text.trim() === '' || preview.state === 'waiting'} onClick={start}>
        {preview.state === 'waiting' ? '作っています…' : '試しに読む'}
      </Button>
      {preview.state === 'error' && (
        <p role="alert" className="text-xs text-danger">
          試しに読めませんでした: {preview.message}
        </p>
      )}
      {preview.state === 'ready' && (
        // 試聴の音。読ませた文は上の欄に出ている。
        <audio controls autoPlay src={preview.url} className="w-full" aria-label="試しに読んだ声" />
      )}
    </div>
  )
}
