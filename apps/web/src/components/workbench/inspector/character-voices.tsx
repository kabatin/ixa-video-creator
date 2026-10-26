'use client'

import { VoiceProfileId, type Character } from '@ixa/domain'
import { useState } from 'react'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { VoiceDesignForm } from '@/components/workbench/inspector/voice-design-form'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { CollapsibleSection } from '@/components/workbench/ui/collapsible-section'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'
import { DUB_LEVEL_RANGE_MESSAGE, parseDubLevelInput } from '@/lib/dub-view'
import { VOICE_TOOL_LABELS } from '@/lib/voice-defaults'

const PICK = ''

/**
 * キャラクターの「声」（ADR-0038）。この人の声（いくつでも）を並べ、作品の声から足すか、この人の声を作る。
 * 誰の声かは声の側に持つ（声のインスペクターの「キャラクター」と同じ値）。セリフの行はこの声で読む。
 */
export const CharacterVoices = ({
  character,
}: {
  readonly character: Pick<Character, 'id' | 'displayName' | 'dialogueVoiceProfileId' | 'dialogueLevelDb'>
}) => {
  const { id: characterId, displayName } = character
  const workbench = useWorkbench()
  const { voices, actions } = useAssets()
  const [error, setError] = useState<string | null>(null)
  const [designing, setDesigning] = useState(false)
  const chooseDialogueVoice = async (voiceId: VoiceProfileId | null): Promise<void> => {
    await actions.updateCharacter(characterId, { dialogueVoiceProfileId: voiceId })
  }
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
    // Shot と同じ畳める見出しの行（2026-10-26。インスペクターの区切りの見た目を揃える）。
    <CollapsibleSection scope="character" id="voices" title={`声（${String(mine.length)}）`} defaultOpen>
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
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={createOwn}>
          この人の声を作る
        </Button>
        <Button
          size="sm"
          disabled={designing}
          onClick={() => {
            setDesigning(true)
          }}
        >
          説明から声を作る
        </Button>
      </div>
      {designing && (
        <VoiceDesignForm
          characterId={characterId}
          displayName={displayName}
          onUseAsDialogueVoice={chooseDialogueVoice}
          onClose={() => {
            setDesigning(false)
          }}
        />
      )}
      {/* 声の差し替え（ADR-0062）。セリフの行を読み直す声と、元の声と同じ大きさにしてから足す距離。 */}
      <AutoSaveSelect
        label="セリフの声"
        value={character.dialogueVoiceProfileId ?? PICK}
        options={[
          { value: PICK, label: 'なし' },
          ...mine.map((voice) => ({ value: voice.id, label: voice.name })),
        ]}
        onSave={(next) => chooseDialogueVoice(next === PICK ? null : VoiceProfileId.parse(next))}
      />
      <AutoSaveField
        label="距離の既定（dB）"
        value={String(character.dialogueLevelDb)}
        placeholder="0"
        validate={(next) => (parseDubLevelInput(next) === null ? DUB_LEVEL_RANGE_MESSAGE : null)}
        onSave={async (next) => {
          await actions.updateCharacter(characterId, { dialogueLevelDb: parseDubLevelInput(next) ?? 0 })
        }}
      />
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted">
        声は 1 人にいくつでも持てます（ふだん・叫び など）。「声を差し替える」は、セリフの声でこの人の行を読み直します。
        距離は元の声と同じ大きさにしてから足します（奥なら -9.5 など）。
      </p>
    </CollapsibleSection>
  )
}
