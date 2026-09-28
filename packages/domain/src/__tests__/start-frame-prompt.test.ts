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
  project: { aspectRatio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 30, styleGuide: '夜明け前、フィルムグレイン' },
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

  it('最初の 1 コマであることを言う', () => {
    expect(compileStartFramePrompt(input())).toMatch(/最初の 1 コマ/)
  })

  it('説明が空でも組み立てられる（画角とスタイルだけでも絵にはなる）', () => {
    expect(compileStartFramePrompt(input({ shot: shot({ description: '' }) }))).toContain('medium closeup')
  })
})
