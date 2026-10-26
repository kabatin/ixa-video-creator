'use client'

import { MediaAssetId, type CharacterId, type DesignedVoiceGender, type VoiceProfileId } from '@ixa/domain'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAssets } from '@/components/workbench/asset-store'
import { INPUT_CLASS, TEXTAREA_CLASS } from '@/components/workbench/ui/section'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { DesignVoiceBody } from '@/lib/dub-api'
import { useRenewableMediaSrc } from '@/lib/use-renewable-media-src'

type Made = { readonly voiceId: VoiceProfileId; readonly name: string; readonly sample: MediaAssetId | null; readonly url: string | null }

type Step =
  | { readonly kind: 'form' }
  | { readonly kind: 'making' }
  | { readonly kind: 'made'; readonly made: Made }

/**
 * 説明から声を作る（Voice Design。ADR-0062）。説明・性別・名前 → 作って試し聞き → 「セリフの声にする」か「閉じる」。
 * **作った時点で声として保存される**（Gemini の側にも残る）。少し費用が掛かるので、押す前にそう書いておく。
 */
export const VoiceDesignForm = ({
  characterId,
  displayName,
  onUseAsDialogueVoice,
  onClose,
}: {
  readonly characterId: CharacterId
  readonly displayName: string
  /** 作った声を、この人の「セリフの声」にする。 */
  readonly onUseAsDialogueVoice: (voiceId: VoiceProfileId) => Promise<void>
  readonly onClose: () => void
}) => {
  const api = useMemo(() => createApiClient(), [])
  const { actions } = useAssets()
  const [description, setDescription] = useState('')
  const [gender, setGender] = useState<DesignedVoiceGender>('female')
  const [name, setName] = useState(`${displayName}のセリフの声`)
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [error, setError] = useState<string | null>(null)

  const make = (): void => {
    const body = DesignVoiceBody.safeParse({ description, gender, displayName: name })
    if (!body.success) {
      setError(body.error.issues[0]?.message ?? '入力を確かめてください')
      return
    }
    setError(null)
    setStep({ kind: 'making' })
    actions
      .designVoice(characterId, body.data)
      .then(async ({ voice, sampleMediaAssetId }) => {
        const sample = sampleMediaAssetId === null ? null : MediaAssetId.parse(sampleMediaAssetId)
        const url = sample === null ? null : (await api.mediaUrl(sample)).url
        setStep({ kind: 'made', made: { voiceId: voice.id, name: voice.name, sample, url } })
      })
      .catch((cause: unknown) => {
        setStep({ kind: 'form' })
        setError(`声を作れませんでした: ${describeForPerson(cause)}`)
      })
  }

  const made = step.kind === 'made' ? step.made : null
  const sample = made?.sample ?? null
  const reload = useCallback(async (): Promise<string> => {
    if (sample === null) throw new Error('試し聞きの声がありません')
    return (await api.mediaUrl(sample)).url
  }, [api, sample])
  const audio = useRenewableMediaSrc({ url: made?.url ?? null, reload, label: '試し聞き' })

  const use = (): void => {
    if (made === null) return
    onUseAsDialogueVoice(made.voiceId)
      .then(onClose)
      .catch((cause: unknown) => {
        setError(`セリフの声にできませんでした: ${describeForPerson(cause)}`)
      })
  }

  return (
    <div role="dialog" aria-label="説明から声を作る" className="space-y-1.5 rounded border border-line p-2 text-xs">
      {made === null ? (
        <>
          <label className="block text-muted">
            説明
            <textarea
              value={description}
              rows={3}
              maxLength={1000}
              placeholder="落ち着いた低い声の、品のある年配の紳士"
              disabled={step.kind === 'making'}
              onChange={(event) => {
                setDescription(event.target.value)
              }}
              className={TEXTAREA_CLASS}
            />
          </label>
          <label className="block text-muted">
            性別
            <select
              value={gender}
              disabled={step.kind === 'making'}
              onChange={(event) => {
                setGender(event.target.value === 'male' ? 'male' : 'female')
              }}
              className={INPUT_CLASS}
            >
              <option value="female">女性</option>
              <option value="male">男性</option>
            </select>
          </label>
          <label className="block text-muted">
            名前
            <input
              value={name}
              maxLength={40}
              disabled={step.kind === 'making'}
              onChange={(event) => {
                setName(event.target.value)
              }}
              className={INPUT_CLASS}
            />
          </label>
          <p className="text-muted">押すと Gemini で声を作り、すぐに声の一覧へ保存します（少し費用が掛かります）。</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={step.kind === 'making'} onClick={make}>
              {step.kind === 'making' ? '作っています…' : '作って試し聞き'}
            </Button>
            <Button size="sm" disabled={step.kind === 'making'} onClick={onClose}>
              閉じる
            </Button>
          </div>
        </>
      ) : (
        <>
          <p role="status" className="text-ok">
            ✓ 「{made.name}」を作って、声の一覧に保存しました
          </p>
          {audio.mediaProps !== null && (
            <audio controls autoPlay {...audio.mediaProps} className="w-full" aria-label="作った声の試し聞き" />
          )}
          {made.sample === null && <p className="text-muted">試し聞きは返ってきませんでした。</p>}
          {audio.error !== null && (
            <p role="alert" className="text-danger">
              {audio.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={use}>
              セリフの声にする
            </Button>
            <Button size="sm" onClick={onClose}>
              閉じる
            </Button>
          </div>
        </>
      )}
      {error !== null && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
