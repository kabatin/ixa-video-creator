import { compileSpec, type CompileInput } from './spec-compiler.js'

export type StartFramePromptInput = Pick<CompileInput, 'project' | 'shot' | 'characters' | 'references'>

/**
 * 絵コンテの画像（Shot の最初のフレーム）の中身の説明（ADR-0029）。
 *
 * **動画と同じ組み立て（`compileSpec`）を使い回す。** Shot の説明・人物・衣装・画角・mood・
 * スタイル指示の並びを画面ごとに書き写すと、片方だけ直ってずれる。
 * 違うのは、静止画なので**カメラの動きを外す**ことだけ（動きの語は絵を崩す）。
 * 尺は説明に出てこないので、そのまま渡す。
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
  return `映像作品の絵コンテ。この Shot の最初の 1 コマを静止画で描く。${spec.prompt}`
}
