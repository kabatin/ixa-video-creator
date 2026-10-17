import { describe, expect, it } from 'vitest'
import { TOOLS } from '../server.js'
import { createFakeApi, depsFor, textOf, ulid } from './fake-api.js'

/**
 * 入力の制約ごとに、破る値を 1 つずつ当てる（制約を外せばここが落ちる）。
 * 基準の入力は検証を通ることを先に確かめ、落ちた理由が狙った項目だと分かるようにする。
 */

const P = ulid('PJ1')
const S = ulid('SH1')
const long = (n: number): string => 'あ'.repeat(n)
const many = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value)

type Case = readonly [patch: Record<string, unknown>, field: string]

const CASES: Record<string, { readonly base: Record<string, unknown>; readonly cases: readonly Case[] }> = {
  ixa_status: { base: {}, cases: [[{ projectId: 'x' }, 'projectId']] },
  set_ai: {
    base: { purpose: 'image', tool: 'klein' },
    cases: [
      [{ purpose: 'audio' }, 'purpose'],
      [{ tool: 'nope' }, 'tool'],
    ],
  },
  create_project: {
    base: { name: 'a' },
    cases: [
      [{ name: '' }, 'name'],
      [{ name: long(201) }, 'name'],
      [{ aspectRatio: '3:2' }, 'aspectRatio'],
      [{ fps: 23 }, 'fps'],
      [{ resolution: { width: 0, height: 1080 } }, 'resolution.width'],
      [{ resolution: { width: 1.5, height: 1080 } }, 'resolution.width'],
      [{ resolution: { width: 1920, height: -1 } }, 'resolution.height'],
      [{ concept: long(20001) }, 'concept'],
      [{ styleGuide: long(4001) }, 'styleGuide'],
      [{ avoid: long(4001) }, 'avoid'],
      [{ budgetUsd: -1 }, 'budgetUsd'],
    ],
  },
  get_project: { base: { projectId: P }, cases: [[{ projectId: 'nope' }, 'projectId']] },
  generate_music: {
    base: { projectId: P, prompt: 'pop', durationSec: 60 },
    cases: [
      [{ prompt: '' }, 'prompt'],
      [{ prompt: long(1001) }, 'prompt'],
      [{ prompt: '   ' }, 'prompt'],
      [{ lyrics: long(4001) }, 'lyrics'],
      [{ durationSec: 9 }, 'durationSec'],
      [{ durationSec: 241 }, 'durationSec'],
      [{ seed: -1 }, 'seed'],
      [{ seed: 1.5 }, 'seed'],
      [{ seed: 2 ** 31 }, 'seed'],
      [{ count: 0 }, 'count'],
      [{ count: 5 }, 'count'],
      [{ count: 1.5 }, 'count'],
      [{ title: '' }, 'title'],
      [{ title: ' ' }, 'title'],
      [{ title: long(201) }, 'title'],
    ],
  },
  upload_music: {
    base: { projectId: P, filePath: '/a/b.mp3' },
    cases: [
      [{ filePath: '' }, 'filePath'],
      [{ filePath: 'b.mp3' }, 'filePath'],
      [{ title: '' }, 'title'],
      [{ title: long(201) }, 'title'],
    ],
  },
  set_master_track: { base: { musicTrackId: S }, cases: [[{ musicTrackId: 'x' }, 'musicTrackId']] },
  music_overview: { base: { projectId: P }, cases: [[{ musicTrackId: 'x' }, 'musicTrackId']] },
  plan_shots: {
    base: { projectId: P, boundariesSec: [0, 2], dryRun: true },
    cases: [
      [{ boundariesSec: [0] }, 'boundariesSec'],
      [{ boundariesSec: many(201, 1) }, 'boundariesSec'],
      [{ boundariesSec: [-1, 2] }, 'boundariesSec.0'],
      [{ boundariesSec: undefined, durationsSec: [] }, 'durationsSec'],
      [{ boundariesSec: undefined, durationsSec: [0] }, 'durationsSec.0'],
      [{ boundariesSec: undefined, durationsSec: many(200, 1) }, 'durationsSec'],
      [{ startSec: -1 }, 'startSec'],
      [{ snap: 'bar' }, 'snap'],
      [{ maxShiftSec: 0 }, 'maxShiftSec'],
      [{ maxShiftSec: 5 }, 'maxShiftSec'],
      [{ model: '' }, 'model'],
      [{ musicTrackId: 'x' }, 'musicTrackId'],
      [{ codePrefix: 'A-B' }, 'codePrefix'],
      [{ codePrefix: 'A'.repeat(17) }, 'codePrefix'],
    ],
  },
  edit_shots: {
    base: { projectId: P, edits: [{ shotIds: [S] }] },
    cases: [
      [{ edits: [] }, 'edits'],
      [{ edits: many(101, { shotIds: [S] }) }, 'edits'],
      [{ edits: [{ shotIds: [] }] }, 'edits.0.shotIds'],
      [{ edits: [{ shotIds: many(201, S) }] }, 'edits.0.shotIds'],
      [{ edits: [{ shotIds: ['x'] }] }, 'edits.0.shotIds.0'],
      [{ edits: [{ shotIds: [S], description: long(4001) }] }, 'edits.0.description'],
      [{ edits: [{ shotIds: [S], mood: long(501) }] }, 'edits.0.mood'],
      [{ edits: [{ shotIds: [S], camera: { size: 'huge' } }] }, 'edits.0.camera.size'],
      [{ edits: [{ shotIds: [S], camera: { lensMm: 0 } }] }, 'edits.0.camera.lensMm'],
      [{ edits: [{ shotIds: [S], camera: { movement: 'zoom' } }] }, 'edits.0.camera.movement'],
      [{ edits: [{ shotIds: [S], locationId: 'x' }] }, 'edits.0.locationId'],
      [{ edits: [{ shotIds: [S], cast: many(9, { characterId: S }) }] }, 'edits.0.cast'],
      [{ edits: [{ shotIds: [S], cast: [{ characterId: S, prominence: 'lead' }] }] }, 'edits.0.cast.0.prominence'],
      [{ edits: [{ shotIds: [S], cast: [{ characterId: S, lookId: 'x' }] }] }, 'edits.0.cast.0.lookId'],
      [{ edits: [{ shotIds: [S], transitionToNext: { type: 'fade' } }] }, 'edits.0.transitionToNext.type'],
      [{ edits: [{ shotIds: [S], transitionToNext: { type: 'dissolve', durationSec: -1 } }] }, 'edits.0.transitionToNext.durationSec'],
      [{ edits: [{ shotIds: [S], transitionToNext: { type: 'dissolve', durationSec: 6 } }] }, 'edits.0.transitionToNext.durationSec'],
    ],
  },
  create_character: {
    base: { projectId: P, name: 'a' },
    cases: [
      [{ name: '' }, 'name'],
      [{ name: long(101) }, 'name'],
      [{ displayName: '' }, 'displayName'],
      [{ displayName: long(201) }, 'displayName'],
      [{ description: long(4001) }, 'description'],
      [{ identityAnchors: many(21, 'a') }, 'identityAnchors'],
      [{ identityAnchors: [''] }, 'identityAnchors.0'],
      [{ identityAnchors: [long(201)] }, 'identityAnchors.0'],
      [{ styleTokens: many(21, 'a') }, 'styleTokens'],
      [{ identityImage: { mediaAssetId: S, role: 'side' } }, 'identityImage.role'],
      [{ identityImage: { imagePath: 'face.png' } }, 'identityImage.imagePath'],
      [{ identityImage: { mediaAssetId: 'x' } }, 'identityImage.mediaAssetId'],
    ],
  },
  create_location: {
    base: { projectId: P, name: 'a' },
    cases: [
      [{ name: '' }, 'name'],
      [{ name: long(201) }, 'name'],
      [{ description: long(4001) }, 'description'],
      [{ references: many(5, { mediaAssetId: S }) }, 'references'],
      [{ references: [{ fromShotStartFrame: 'x' }] }, 'references.0.fromShotStartFrame'],
    ],
  },
  draw_start_frames: {
    base: { projectId: P, shotIds: [S] },
    cases: [
      [{ shotIds: [] }, 'shotIds'],
      [{ shotIds: many(101, S) }, 'shotIds'],
    ],
  },
  set_start_frame: { base: { shotId: S, mediaAssetId: S }, cases: [[{ shotId: 'x' }, 'shotId']] },
  view: {
    base: { mediaAssetId: S },
    cases: [
      [{ frames: 0 }, 'frames'],
      [{ frames: 9 }, 'frames'],
      [{ frames: 1.5 }, 'frames'],
      [{ width: 255 }, 'width'],
      [{ width: 1281 }, 'width'],
      [{ takeId: 'x' }, 'takeId'],
    ],
  },
  generate_takes: {
    base: { projectId: P, shotIds: [S], model: 'AUTO' },
    cases: [
      [{ shotIds: [] }, 'shotIds'],
      [{ shotIds: many(201, S) }, 'shotIds'],
      [{ model: '' }, 'model'],
      [{ count: 0 }, 'count'],
      [{ count: 5 }, 'count'],
      [{ corrections: many(6, 'a') }, 'corrections'],
      [{ corrections: [''] }, 'corrections.0'],
      [{ corrections: [long(501)] }, 'corrections.0'],
      [{ seed: -1 }, 'seed'],
      [{ seed: 2 ** 31 }, 'seed'],
      [{ parentTakeId: 'x' }, 'parentTakeId'],
      [{ regenerationReason: ' ' }, 'regenerationReason'],
      [{ regenerationReason: long(201) }, 'regenerationReason'],
    ],
  },
  list_takes: { base: { shotId: S }, cases: [[{ shotId: 'x' }, 'shotId']] },
  adopt_take: {
    base: { shotId: S, takeId: S },
    cases: [
      [{ shotIds: [] }, 'shotIds'],
      [{ shotIds: many(201, S) }, 'shotIds'],
      [{ rule: 'first' }, 'rule'],
    ],
  },
  upscale_takes: {
    base: { shotId: S, takeId: S },
    cases: [
      [{ shotIds: [] }, 'shotIds'],
      [{ shotIds: many(201, S) }, 'shotIds'],
    ],
  },
  wait: {
    base: { projectId: P },
    cases: [
      [{ projectId: undefined, jobs: [] }, 'jobs'],
      [{ projectId: undefined, jobs: many(201, { kind: 'render', id: S }) }, 'jobs'],
      [{ projectId: undefined, jobs: [{ kind: 'nope', id: S }] }, 'jobs.0.kind'],
      [{ projectId: undefined, jobs: [{ kind: 'sfx', id: 'x' }] }, 'jobs.0.id'],
      [{ projectId: undefined, jobs: [{ kind: 'upscale', shotId: S }] }, 'jobs.0.takeId'],
      [{ maxWaitSec: 0 }, 'maxWaitSec'],
      [{ maxWaitSec: 901 }, 'maxWaitSec'],
      [{ maxWaitSec: 1.5 }, 'maxWaitSec'],
    ],
  },
  add_effects: {
    base: { projectId: P, effects: [{ template: 'flash', atSec: 0 }] },
    cases: [
      [{ effects: [] }, 'effects'],
      [{ effects: many(101, { template: 'flash', atSec: 0 }) }, 'effects'],
      [{ effects: [{ template: 'ink_splash', atSec: 0 }] }, 'effects.0.template'],
      [{ effects: [{ template: 'flash', atSec: -1 }] }, 'effects.0.atSec'],
      [{ effects: [{ template: 'flash', atSec: 0, durationSec: 0 }] }, 'effects.0.durationSec'],
      [{ effects: [{ template: 'flash', atSec: 0, durationSec: 31 }] }, 'effects.0.durationSec'],
      [{ effects: [{ template: 'flash', shotCode: '' }] }, 'effects.0.shotCode'],
    ],
  },
  list_effects: { base: { projectId: P }, cases: [[{ projectId: 'x' }, 'projectId']] },
  remove_effects: {
    base: { projectId: P, effectIds: [S] },
    cases: [
      [{ projectId: 'x' }, 'projectId'],
      [{ effectIds: [] }, 'effectIds'],
      [{ effectIds: ['x'] }, 'effectIds.0'],
      [{ effectIds: many(201, S) }, 'effectIds'],
    ],
  },
  suggest_sfx: { base: { projectId: P }, cases: [[{ projectId: 'x' }, 'projectId']] },
  generate_sfx: {
    base: { projectId: P, cues: [{ startSec: 1, durationSec: 1, prompt: 'impact hit' }] },
    cases: [
      [{ cues: [] }, 'cues'],
      [{ cues: many(31, { startSec: 1, durationSec: 1, prompt: 'hit' }) }, 'cues'],
      [{ cues: [{ startSec: -1, durationSec: 1, prompt: 'hit' }] }, 'cues.0.startSec'],
      [{ cues: [{ startSec: 1, durationSec: 0.4, prompt: 'hit' }] }, 'cues.0.durationSec'],
      [{ cues: [{ startSec: 1, durationSec: 10.5, prompt: 'hit' }] }, 'cues.0.durationSec'],
      [{ cues: [{ startSec: 1, durationSec: 1, prompt: '' }] }, 'cues.0.prompt'],
      [{ cues: [{ startSec: 1, durationSec: 1, prompt: 'a'.repeat(501) }] }, 'cues.0.prompt'],
      [{ cues: [{ startSec: 1, durationSec: 1, prompt: '爆発音' }] }, 'cues.0.prompt'],
      [{ cues: [{ startSec: 1, durationSec: 1, prompt: 'hit', volume: 2.1 }] }, 'cues.0.volume'],
      [{ model: 'ace_step' }, 'model'],
      [{ count: 0 }, 'count'],
      [{ count: 5 }, 'count'],
      [{ seed: -1 }, 'seed'],
    ],
  },
  list_sfx: { base: { projectId: P }, cases: [[{ projectId: 'x' }, 'projectId']] },
  remove_sfx: {
    base: { projectId: P, clipIds: [S] },
    cases: [
      [{ clipIds: [] }, 'clipIds'],
      [{ clipIds: ['x'] }, 'clipIds.0'],
      [{ clipIds: many(201, S) }, 'clipIds'],
    ],
  },
  export: {
    base: { projectId: P },
    cases: [
      [{ preset: 'master_8k' }, 'preset'],
      [{ waitSec: -1 }, 'waitSec'],
      [{ waitSec: 901 }, 'waitSec'],
      [{ renderJobId: 'x' }, 'renderJobId'],
    ],
  },
  export_thumbnail: {
    base: { projectId: P, background: { atSec: 1 }, title: '新曲' },
    cases: [
      [{ waitSec: 901 }, 'waitSec'],
      [{ candidateIndex: -1 }, 'candidateIndex'],
      [{ layout: 'right' }, 'layout'],
      [{ font: 'comic' }, 'font'],
      [{ background: { mediaAssetId: 'x' } }, 'background.mediaAssetId'],
      [{ background: { atSec: -1 } }, 'background.atSec'],
      [{ background: { keyArt: { instruction: long(501) } } }, 'background.keyArt.instruction'],
      [{ thumbnailId: 'x' }, 'thumbnailId'],
    ],
  },
}

describe('入力の制約', () => {
  it('すべてのツールに表がある', () => {
    expect(Object.keys(CASES).sort()).toEqual(TOOLS.map((t) => t.name).sort())
  })

  TOOLS.forEach((tool) => {
    const table = CASES[tool.name]
    if (table === undefined) return
    it(`${tool.name}: 基準の入力は通る`, () => {
      expect(tool.input.safeParse(table.base).success).toBe(true)
    })
    table.cases.forEach(([patch, field]) => {
      it(`${tool.name}: ${field} を破ると API を呼ばずに断る (${JSON.stringify(patch).slice(0, 60)})`, async () => {
        const fake = createFakeApi([])
        const result = await tool.run({ ...table.base, ...patch }, depsFor(fake))
        expect(result.isError).toBe(true)
        expect(textOf(result)).toContain('入力が不正です')
        expect(textOf(result)).toContain(`${field}:`)
        expect(fake.calls).toHaveLength(0)
      })
    })
  })
})
