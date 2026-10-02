import { describe, expect, it } from 'vitest'
import { ProjectId, ShotId } from '../common/ids.js'
import { compileStartFramePrompt, type StartFramePromptInput } from '../generation/start-frame-prompt.js'
import type { Shot } from '../shot/shot.js'

/**
 * 絵コンテの画像（Shot の最初のフレーム）の中身の説明（ADR-0029）。
 * **動画と同じ組み立て（`compileSpec`）を使い回す。** 画面ごとに書き写すとずれる。
 * 違うのは、静止画なので**カメラの動きを外す**ことだけ。
 */

const shot = (overrides: Partial<Shot> = {}): Shot => ({
  id: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  projectId: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  sequenceId: null,
  locationId: null,
  order: 1000,
  code: 'shot_014',
  startSec: 51.2,
  durationSec: 3.75,
  sourceInSec: 0,
  timing: 'trim',
  description: '暗いガレージ。作業台にマットブラックのヘルメット',
  dialogue: null,
  camera: {
    size: 'medium_closeup', angleH: 'front_left', angle: 'low',
    lensMm: 50, movement: 'push_in', movementIntensity: 'subtle',
  },
  mood: '緊迫',
  continuityMode: 'independent',
  sourceType: { type: 'ai_video' },
  selectedTakeId: null,
  status: 'ready',
  lockedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const input = (overrides: Partial<StartFramePromptInput> = {}): StartFramePromptInput => ({
  project: {
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    styleGuide: '夜明け前、フィルムグレイン',
    avoid: '',
  },
  shot: shot(),
  characters: [],
  references: [],
  ...overrides,
})

describe('compileStartFramePrompt', () => {
  it('Shot の説明・画角・mood・スタイル指示を入れる', () => {
    const prompt = compileStartFramePrompt(input())
    expect(prompt).toContain('暗いガレージ')
    expect(prompt).toContain('medium closeup')
    expect(prompt).toContain('50mm lens')
    expect(prompt).toContain('緊迫')
    expect(prompt).toContain('フィルムグレイン')
  })

  it('静止画なのでカメラの動きは入れない', () => {
    const prompt = compileStartFramePrompt(input())
    expect(prompt).not.toContain('push in')
    expect(prompt).not.toContain('subtle')
  })

  /**
   * 動画の 1 フレーム目（制作者 2026-10-02「生成する画像は動画生成の 1 フレーム目の画像なので、プロンプトでそこを強く伝える必要がありそう」）。
   * 説明は Shot の間に起きること（例「立ち上がったはるとが…歩き出す」）なので、絵がその途中や頂点を描いて、
   * そこから動画を始めると動く先が無かった。**動きが始まる直前**を描かせる。
   */
  it('N 秒の動画の 1 フレーム目（開始画像）で、説明の動きが始まる直前を描く、と先に言う', () => {
    const prompt = compileStartFramePrompt(input())
    const head = prompt.slice(0, prompt.indexOf('暗いガレージ'))

    expect(head).toMatch(/3\.75 秒の動画/)
    expect(head).toMatch(/1 フレーム目/)
    expect(head).toMatch(/開始画像/)
    expect(head).toMatch(/始まる直前/)
  })

  it('映画の 1 コマとして描かせ、コマ割り・枠・下描き風・ブレを禁じる。「絵コンテ」とは言わない', () => {
    const prompt = compileStartFramePrompt(input())

    expect(prompt).toMatch(/映画の 1 コマ/)
    expect(prompt).toMatch(/コマ割り/)
    expect(prompt).toMatch(/下描き/)
    expect(prompt).toMatch(/ブレ/)
    expect(prompt).not.toContain('絵コンテ')
  })

  it('説明が空でも組み立てられる（画角とスタイルだけでも絵にはなる）', () => {
    expect(compileStartFramePrompt(input({ shot: shot({ description: '' }) }))).toContain('medium closeup')
  })
})

/**
 * 作品の方針の「避けたいもの」（ADR-0030）。否定の指定を受けるモデルが無いので、
 * 絵の指示文に「避けること」として入れる（Codex は指示文をよく守る）。
 */
describe('compileStartFramePrompt — 避けたいもの', () => {
  it('書いてあれば「避けること」として末尾に入れる', () => {
    const prompt = compileStartFramePrompt(input({ project: { ...input().project, avoid: '文字、透かし、アニメ調' } }))
    expect(prompt).toContain('避けること: 文字、透かし、アニメ調')
    expect(prompt.trimEnd().endsWith('避けること: 文字、透かし、アニメ調')).toBe(true)
  })

  it('空なら入れない', () => {
    expect(compileStartFramePrompt(input())).not.toContain('避けること')
  })
})
