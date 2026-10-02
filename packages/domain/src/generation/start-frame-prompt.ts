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
 *
 * **動画の 1 フレーム目（開始画像）として描かせる**（制作者 2026-10-02「生成する画像は動画生成の 1 フレーム目の画像なので、
 * プロンプトでそこを強く伝える必要がありそう」）。Shot の説明は Shot の間に起きること（「立ち上がったはるとが…歩き出す」）
 * なので、そのまま渡すと絵が動きの途中や頂点を描き、そこから動画を始めると動く先が無かった。
 * 先に「何秒の動画の開始画像か」「説明の動きが始まる直前を描く」を言い、説明はその後に置く。
 * 「絵コンテ」という語は使わない（コマ割り・下描き風の絵に寄る。描いてほしいのは映画の 1 コマ）。
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
  const seconds = String(Math.round(input.shot.durationSec * 100) / 100)
  return [
    `これは ${seconds} 秒の動画を作るときの 1 フレーム目（動画の開始画像）。この 1 枚から映像が動き始める。`,
    `下の「この Shot で起きること」は ${seconds} 秒の間に起きること。その動きが始まる直前の瞬間を描く（動きの途中や結末を描かない）。`,
    '',
    `この Shot で起きること: ${spec.prompt}`,
    '',
    '描き方:',
    '- 映画の 1 コマ（撮影した映像から切り出した静止画）として描く。コマ割り・枠・余白・下描き風・線画にしない',
    '- 人物は、これから動き出せる自然な姿勢で描く。ブレや残像は描かない',
    '- 画角と向きは説明の通り',
    ...(avoid === '' ? [] : ['', `避けること: ${avoid}`]),
  ].join('\n')
}
