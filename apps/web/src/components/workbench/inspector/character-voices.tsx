'use client'

import type { CharacterId } from '@ixa/domain'
import { useState } from 'react'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { Section } from '@/components/workbench/ui/section'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'
import { VOICE_TOOL_LABELS } from '@/lib/voice-defaults'

const PICK = ''

/**
 * キャラクターの「声」（ADR-0038）。この人の声（いくつでも）を並べ、作品の声から足すか、この人の声を作る。
 * 誰の声かは声の側に持つ（声のインスペクターの「キャラクター」と同じ値）。セリフの行はこの声で読む。
 */
export const CharacterVoices = ({ characterId, displayName }: { readonly characterId: CharacterId; readonly displayName: string }) => {
  const workbench = useWorkbench()
  const { voices, actions } = useAssets()
  const [error, setError] = useState<string | null>(null)
  const all = readyOr(voices)
  const mine = all.filter((voice) => voice.characterId === characterId)
  const others = all.filter((voice) => voice.characterId !== characterId)

  const createOwn = (): void => {
    setError(null)
    actions
      .createVoice(`${displayName}の声`)
      .then((created) => actions.updateVoice(created.id, { characterId }))
      .then((voice) => {
        workbench.inspect({ kind: 'voice', id: voice.id })
      })
      .catch((cause: unknown) => {
        setError(`声を作れませんでした: ${describeForPerson(cause)}`)
      })
  }

  return (
    <Section title={`声（${String(mine.length)}）`}>
      {mine.map((voice) => (
        <button
          key={voice.id}
          type="button"
          onClick={() => {
            workbench.inspect({ kind: 'voice', id: voice.id })
          }}
          className="flex h-6 w-full items-center gap-2 rounded px-1 text-left text-sm text-text hover:bg-surface-2"
        >
          <span className="flex-1 truncate">{voice.name}</span>
          <span className="text-xs text-muted">{VOICE_TOOL_LABELS[voice.tool]}</span>
        </button>
      ))}
      {others.length > 0 && (
        <AutoSaveSelect
          label="作品の声から足す"
          value={PICK}
          options={[{ value: PICK, label: '選ぶ…' }, ...others.map((voice) => ({ value: voice.id, label: voice.name }))]}
          onSave={async (next) => {
            const voice = others.find((candidate) => candidate.id === next)
            if (voice !== undefined) await actions.updateVoice(voice.id, { characterId })
          }}
        />
      )}
      <Button size="sm" onClick={createOwn}>
        この人の声を作る
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted">セリフの行はこの声で読みます。声は 1 人にいくつでも持てます（ふだん・叫び など）。</p>
    </Section>
  )
}
