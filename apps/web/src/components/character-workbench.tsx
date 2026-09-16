'use client'

import type { Character, CharacterIdentityImage, CharacterLook } from '@ixa/domain'
import { CharacterEditor } from '@/components/character-editor'
import { IdentityImagePanel } from '@/components/identity-image-panel'
import { LookPanel } from '@/components/look-panel'

export type CharacterWorkbenchProps = {
  readonly character: Character
  readonly initialIdentityImages: readonly CharacterIdentityImage[]
  readonly initialLooks: readonly CharacterLook[]
}

/**
 * キャラクター詳細の中核。
 * 同一性（Character）と、時系列で変わる外見（Look）を 2 層のまま並べる。
 */
export const CharacterWorkbench = ({
  character,
  initialIdentityImages,
  initialLooks,
}: CharacterWorkbenchProps) => (
  <div className="space-y-10">
    <CharacterEditor character={character} />

    <IdentityImagePanel
      characterId={character.id}
      workspaceId={character.workspaceId}
      initialImages={initialIdentityImages}
    />

    <LookPanel
      characterId={character.id}
      workspaceId={character.workspaceId}
      initialLooks={initialLooks}
    />
  </div>
)
