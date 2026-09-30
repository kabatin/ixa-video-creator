import type { Project } from '../project/project.js'
import { compileSpec, type CompileInput } from './spec-compiler.js'

export type StartFramePromptInput = Pick<CompileInput, 'shot' | 'characters' | 'references'> & {
  readonly project: CompileInput['project'] & Pick<Project, 'avoid'>
}

/**
 * 絵コンテの画像（Shot の最初のフレーム）の中身の説明（ADR-0029）。
 *
 * **動画と同じ組み立て（`compileSpec`）を使い回す。** Shot の説明・人物・衣装・画角・mood・
 * スタイル指示（作品のルック）の並びを画面ごとに書き写すと、片方だけ直ってずれる。
 * 違うのは、静止画なので**カメラの動きを外す**ことだけ（動きの語は絵を崩す）。
 * 尺は説明に出てこないので、そのまま渡す。
 *
 * 作品の「避けたいもの」（ADR-0030）は、否定の指定を受けるモデルが無いので**指示文の末尾に書く**。
 * 絵を作る Codex は指示文をよく守る。映像の仕様には入れない（`compileSpec` の negativePrompt は null のまま）。
 */
export const compileStartFramePrompt = (input: StartFramePromptInput): string => {
  const still = {
    ...input.shot,
    camera: { ...input.shot.camera, movement: null, movementIntensity: null },
  }
  const spec = compileSpec({
    ...input,
    shot: still,
    generationDurationSec: input.shot.durationSec,
    seed: null,
    negativePrompt: null,
  })
  const avoid = input.project.avoid.trim()
  return [
    `映像作品の絵コンテ。この Shot の最初の 1 コマを静止画で描く。${spec.prompt}`,
    ...(avoid === '' ? [] : [`避けること: ${avoid}`]),
  ].join('\n')
}
