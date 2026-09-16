import type { ShotGenerationSpec } from '@ixa/domain'
import type { VideoModelDescriptor } from '@ixa/provider-core'

/**
 * 画面に焼き込む行の組み立て（ADR-0014）。
 * どの Shot の何回目の生成かが、動画を開いた瞬間に分かることが目的。
 */

const SHOT_LABEL_LENGTH = 8
const DESCRIPTION_LENGTH = 40
const SPEC_HASH_LENGTH = 8

/**
 * ShotGenerationSpec は Shot の `code` を持たない（Provider 境界には出さない設計）。
 * そのため shotId の先頭 8 文字を Shot の識別子として表示する。
 */
export const shotLabel = (spec: ShotGenerationSpec): string =>
  `shot ${spec.shotId.slice(0, SHOT_LABEL_LENGTH)}`

export const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : value.slice(0, maxLength)

export type PlaceholderLinesInput = {
  readonly spec: ShotGenerationSpec
  readonly model: VideoModelDescriptor
  readonly generationDurationSec: number
  readonly specHash: string
}

export const placeholderLines = ({
  spec,
  model,
  generationDurationSec,
  specHash,
}: PlaceholderLinesInput): readonly string[] => {
  const description =
    spec.promptParts.shotDescription.length > 0 ? spec.promptParts.shotDescription : spec.prompt

  return [
    shotLabel(spec),
    truncate(description, DESCRIPTION_LENGTH),
    spec.camera.size,
    `${generationDurationSec}s @ ${spec.fps}fps`,
    `spec ${specHash.slice(0, SPEC_HASH_LENGTH)}`,
    model.id,
  ]
}
