import type { Project } from '../project/project.js'
import type { Shot } from '../shot/shot.js'
import { cameraToPromptFragment } from '../shot/camera.js'
import type { CharacterBundle, ResolvedReference } from './reference-resolver.js'
import type { ShotGenerationSpec } from './spec.js'
import { canonicalJson } from './spec.js'

export type CompileInput = {
  readonly project: Pick<Project, 'aspectRatio' | 'resolution' | 'fps' | 'styleGuide'>
  readonly shot: Shot
  readonly characters: readonly CharacterBundle[]
  readonly references: readonly ResolvedReference[]
  /** モデルの対応値へ切り上げ済みの生成尺（ADR-0011）。 */
  readonly generationDurationSec: number
  readonly seed: number | null
  readonly negativePrompt: string | null
  /**
   * レビューの指摘から人が選んだ直し（PHASE 6.1）。
   * 空・未指定なら仕様にキーを置かない。置くとハッシュが変わり、重複検知が壊れる。
   */
  readonly corrections?: readonly string[]
}

/** 空白のみを落とし、trim して並べ直す。順序は呼び出し側の指定を保つ。 */
const normalizeCorrections = (values: readonly string[] | undefined): string[] =>
  (values ?? []).map((v) => v.trim()).filter((v) => v.length > 0)

/**
 * Shot から Provider 非依存の生成仕様を**決定的に**組み立てる。
 *
 * LLM によるプロンプト拡張は既定で行わない（ARCHITECTURE.md §11）。
 * 再現性が落ち、人間の意図がぼやけるため。
 * 代わりに promptParts を残し、人間が最終プロンプトを直接編集できるようにする。
 */
export const compileSpec = (input: CompileInput): ShotGenerationSpec => {
  const { project, shot } = input

  const identityAnchors = dedupe(input.characters.flatMap((c) => c.character.identityAnchors))
  const wardrobeTokens = dedupe(input.characters.flatMap((c) => c.look.wardrobeTokens))
  const styleTokens = dedupe([
    ...input.characters.flatMap((c) => c.character.styleTokens),
    ...input.characters.flatMap((c) => c.look.styleTokens),
  ])
  const colorPalette = dedupe([
    ...input.characters.flatMap((c) => c.character.colorPalette),
    ...input.characters.flatMap((c) => c.look.colorPalette),
  ])

  const cameraFragment = cameraToPromptFragment(shot.camera)
  const moodFragment = shot.mood

  const promptParts = {
    styleGuide: project.styleGuide,
    shotDescription: shot.description,
    identityAnchors,
    styleTokens,
    colorPalette,
    wardrobeTokens,
    cameraFragment,
    moodFragment,
  }

  const corrections = normalizeCorrections(input.corrections)

  return {
    specVersion: 1,
    shotId: shot.id,
    sourceType: shot.sourceType.type,
    /**
     * 直しは**最終プロンプトの末尾へ連結する**。`promptParts` に入れるだけでは
     * Provider に届かない。既存の断片の順序は動かさない（`assemblePrompt` の注記）。
     */
    prompt: [assemblePrompt(promptParts), ...corrections].join('. '),
    negativePrompt: input.negativePrompt,
    promptParts,
    durationSec: input.generationDurationSec,
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    fps: project.fps,
    seed: input.seed,
    references: input.references.map((r) => ({
      mediaAssetId: r.mediaAssetId,
      role: r.role,
      weight: r.weight,
    })),
    camera: shot.camera,
    /**
     * **差分があるときだけキーを置く。** 無条件に `corrections: []` を置くと
     * `JSON.stringify` の結果が変わり、既存の Take と specHash が一致しなくなる。
     */
    ...(corrections.length > 0 ? { corrections } : {}),
  }
}

/**
 * 断片を決まった順序で連結する。**順序を変えないこと**。
 * 順序が変わると specHash が変わり、同一入力の判定が壊れる。
 */
export const assemblePrompt = (parts: ShotGenerationSpec['promptParts']): string => {
  const segments = [
    parts.shotDescription,
    parts.identityAnchors.join(', '),
    parts.wardrobeTokens.join(', '),
    parts.cameraFragment,
    parts.moodFragment ?? '',
    parts.styleTokens.join(', '),
    parts.colorPalette.length > 0 ? `color palette: ${parts.colorPalette.join(', ')}` : '',
    parts.styleGuide,
  ]
  return segments.map((s) => s.trim()).filter((s) => s.length > 0).join('. ')
}

const dedupe = (values: readonly string[]): string[] => [...new Set(values.filter((v) => v.trim() !== ''))]

/**
 * 仕様のハッシュ。同一入力の重複生成を検知する。
 * canonicalJson を通すのでキー順に依存しない。
 */
export const computeSpecHash = async (spec: ShotGenerationSpec): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(spec))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
