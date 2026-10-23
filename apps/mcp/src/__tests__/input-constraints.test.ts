import { describe, expect, it } from 'vitest'
import { TOOLS } from '../server.js'
import { createFakeApi, depsFor, textOf, ulid } from './fake-api.js'

/**
 * 入力の制約ごとに、破る値を 1 つずつ当てる（制約を外せばここが落ちる）。
 * 基準の入力は検証を通ることを先に確かめ、落ちた理由が狙った項目だと分かるようにする。
 */

const P = ulid('PJ1')
const S = ulid('SH1')
const P2 = ulid('PJ2')
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
  list_start_frame_history: { base: { shotId: S }, cases: [[{ shotId: 'x' }, 'shotId']] },
  use_start_frame: {
    base: { shotId: S, jobId: S },
    cases: [
      [{ shotId: 'x' }, 'shotId'],
      [{ jobId: 'x' }, 'jobId'],
    ],
  },
  retry_image: { base: { jobId: S }, cases: [[{ jobId: 'x' }, 'jobId']] },
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
      [{ autoRetake: 'yes' }, 'autoRetake'],
    ],
  },
  list_takes: { base: { shotId: S }, cases: [[{ shotId: 'x' }, 'shotId']] },
  review_take: { base: { takeId: S }, cases: [[{ takeId: 'x' }, 'takeId']] },
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
  analyze_motion: {
    base: { shotId: S },
    cases: [
      [{ shotId: 'x' }, 'shotId'],
      [{ takeId: 'x' }, 'takeId'],
      [{ maxWaitSec: 0 }, 'maxWaitSec'],
      [{ maxWaitSec: 601 }, 'maxWaitSec'],
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
      [{ cues: [{ startSec: 1, durationSec: 1, prompt: 'hit', negativePrompt: '音楽' }] }, 'cues.0.negativePrompt'],
      [{ cues: [{ startSec: 3601, durationSec: 1, prompt: 'hit' }] }, 'cues.0.startSec'],
      [{ cues: [{ startSec: 1, durationSec: 1, prompt: 'hit', align: { to: 'end', notBeforeSec: 0 } }] }, 'cues.0.align.to'],
      [{ cues: [{ startSec: 1, durationSec: 1, prompt: 'hit', align: { to: 'peak', notBeforeSec: -1 } }] }, 'cues.0.align.notBeforeSec'],
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
      [{ accentBar: 'no' }, 'accentBar'],
      [{ font: 'comic' }, 'font'],
      [{ background: { mediaAssetId: 'x' } }, 'background.mediaAssetId'],
      [{ background: { atSec: -1 } }, 'background.atSec'],
      [{ background: { keyArt: { instruction: long(501) } } }, 'background.keyArt.instruction'],
      [{ thumbnailId: 'x' }, 'thumbnailId'],
    ],
  },
  update_project: {
    base: { projectId: P },
    cases: [
      [{ projectId: 'x' }, 'projectId'],
      [{ name: '' }, 'name'],
      [{ name: long(201) }, 'name'],
      [{ concept: '' }, 'concept'],
      [{ concept: long(20001) }, 'concept'],
      [{ styleGuide: long(4001) }, 'styleGuide'],
      [{ styleReferences: many(4, { mediaAssetId: S }) }, 'styleReferences'],
      [{ styleReferences: [{ imagePath: 'a.png' }] }, 'styleReferences.0.imagePath'],
      [{ durationSec: 0 }, 'durationSec'],
      [{ budgetUsd: -1 }, 'budgetUsd'],
      [{ status: 'archived' }, 'status'],
    ],
  },
  duplicate_project: {
    base: { projectId: P, name: '複製' },
    cases: [
      [{ projectId: 'x' }, 'projectId'],
      [{ name: '  ' }, 'name'],
      [{ name: long(201) }, 'name'],
      [{ items: ['concept', 'concept'] }, 'items'],
      [{ items: ['nope'] }, 'items.0'],
    ],
  },
  import_from_project: {
    base: { projectId: P, sourceProjectId: P2, action: 'list' },
    cases: [
      [{ action: 'copy' }, 'action'],
      [{ sourceProjectId: 'x' }, 'sourceProjectId'],
      [{ characterIds: many(51, S) }, 'characterIds'],
      [{ voiceIds: ['x'] }, 'voiceIds.0'],
      [{ sfxSounds: [{ sfxJobId: S, mediaAssetId: S, extra: 1 }] }, 'sfxSounds.0'],
      [{ sfxSounds: many(51, { sfxJobId: S, mediaAssetId: S }) }, 'sfxSounds'],
    ],
  },
  restructure_shots: {
    base: { projectId: P, action: 'delete', shotIds: [S] },
    cases: [
      [{ action: 'reorder' }, 'action'],
      [{ shotIds: [] }, 'shotIds'],
      [{ shotIds: many(201, S) }, 'shotIds'],
      [{ atSec: -1 }, 'atSec'],
      [{ afterShotId: 'x' }, 'afterShotId'],
      [{ code: ' ' }, 'code'],
      [{ code: long(41) }, 'code'],
      [{ durationSec: 0 }, 'durationSec'],
      [{ mood: long(501) }, 'mood'],
      [{ dialogue: long(2001) }, 'dialogue'],
    ],
  },
  draft_storyboard: {
    base: { projectId: P, action: 'latest' },
    cases: [
      [{ action: 'rewrite' }, 'action'],
      [{ runId: 'x' }, 'runId'],
      [{ shotIds: [] }, 'shotIds'],
      [{ shotIds: [S, S] }, 'shotIds'],
      [{ field: 'title' }, 'field'],
      [{ current: long(4001) }, 'current'],
      [{ instruction: long(301) }, 'instruction'],
    ],
  },
  edit_character: {
    base: { projectId: P, characterId: S, action: 'get' },
    cases: [
      [{ characterId: 'x' }, 'characterId'],
      [{ action: 'rename' }, 'action'],
      [{ character: { name: '' } }, 'character.name'],
      [{ character: { identityAnchors: many(21, 'a') } }, 'character.identityAnchors'],
      [{ look: { key: 'winter' } }, 'look.key'],
      [{ look: { era: long(201) } }, 'look.era'],
      [{ role: 'face_back' }, 'role'],
      [{ image: { imagePath: 'a.png' } }, 'image.imagePath'],
    ],
  },
  edit_location: {
    base: { projectId: P, locationId: S, action: 'delete' },
    cases: [
      [{ locationId: 'x' }, 'locationId'],
      [{ action: 'create' }, 'action'],
      [{ name: '' }, 'name'],
      [{ description: long(4001) }, 'description'],
      [{ references: many(5, { mediaAssetId: S }) }, 'references'],
    ],
  },
  manage_brand_assets: {
    base: { projectId: P, action: 'list' },
    cases: [
      [{ action: 'clear' }, 'action'],
      [{ brandAssetId: 'x' }, 'brandAssetId'],
      [{ category: 'sound' }, 'category'],
      [{ name: long(201) }, 'name'],
      [{ value: '#FFF' }, 'value'],
      [{ usageRule: long(4001) }, 'usageRule'],
    ],
  },
  import_take: {
    base: { projectId: P, shotId: S, filePath: '/a/b.mp4' },
    cases: [
      [{ shotId: 'x' }, 'shotId'],
      [{ filePath: '' }, 'filePath'],
      [{ filePath: 'b.mp4' }, 'filePath'],
      [{ sourceModel: ' ' }, 'sourceModel'],
      [{ sourceModel: long(121) }, 'sourceModel'],
    ],
  },
  hide_takes: {
    base: { takeIds: [S] },
    cases: [
      [{ takeIds: [] }, 'takeIds'],
      [{ takeIds: ['x'] }, 'takeIds.0'],
      [{ takeIds: many(51, S) }, 'takeIds'],
    ],
  },
  cancel_jobs: {
    base: { projectId: P, kind: 'music' },
    cases: [
      [{ kind: 'audio' }, 'kind'],
      [{ shotIds: [] }, 'shotIds'],
      [{ shotIds: many(201, S) }, 'shotIds'],
      [{ lineIds: ['x'] }, 'lineIds.0'],
      [{ lineIds: many(1001, S) }, 'lineIds'],
    ],
  },
  align_to_music: {
    base: { projectId: P, action: 'check' },
    cases: [
      [{ action: 'fix' }, 'action'],
      [{ changes: [] }, 'changes'],
      [{ changes: many(501, { kind: 'select', shotId: S, takeId: S, reason: '拍' }) }, 'changes'],
      [{ changes: [{ kind: 'swap', shotId: S, reason: '拍' }] }, 'changes.0.kind'],
      [{ changes: [{ kind: 'move', shotId: S, fromSec: -1, toSec: 1, reason: '拍' }] }, 'changes.0.fromSec'],
      [{ changes: [{ kind: 'trim', shotId: S, fromDurationSec: 2, toDurationSec: 0, reason: '拍' }] }, 'changes.0.toDurationSec'],
      [{ changes: [{ kind: 'select', shotId: S, takeId: S, reason: '' }] }, 'changes.0.reason'],
    ],
  },
  add_telops: {
    base: { projectId: P, telops: [{ text: '新曲', atSec: 0 }] },
    cases: [
      [{ telops: [] }, 'telops'],
      [{ telops: many(101, { text: '新曲', atSec: 0 }) }, 'telops'],
      [{ telops: [{ text: '  ', atSec: 0 }] }, 'telops.0.text'],
      [{ telops: [{ text: long(121), atSec: 0 }] }, 'telops.0.text'],
      [{ telops: [{ text: '新曲', atSec: -1 }] }, 'telops.0.atSec'],
      [{ telops: [{ text: '新曲', durationSec: 0.4 }] }, 'telops.0.durationSec'],
      [{ telops: [{ text: '新曲', durationSec: 61 }] }, 'telops.0.durationSec'],
      [{ telops: [{ text: '新曲', template: 'center' }] }, 'telops.0.template'],
      [{ telops: [{ text: '新曲', layer: 21 }] }, 'telops.0.layer'],
      [{ telops: [{ text: '新曲', layer: 1.5 }] }, 'telops.0.layer'],
    ],
  },
  list_telops: { base: { projectId: P }, cases: [[{ projectId: 'x' }, 'projectId']] },
  edit_clips: {
    base: { projectId: P, edits: [{ clipId: S }] },
    cases: [
      [{ edits: [] }, 'edits'],
      [{ edits: many(201, { clipId: S }) }, 'edits'],
      [{ edits: [{ clipId: 'x' }] }, 'edits.0.clipId'],
      [{ edits: [{ clipId: S, startSec: -1 }] }, 'edits.0.startSec'],
      [{ edits: [{ clipId: S, durationSec: 0 }] }, 'edits.0.durationSec'],
      [{ edits: [{ clipId: S, durationSec: 601 }] }, 'edits.0.durationSec'],
      [{ edits: [{ clipId: S, layer: -1 }] }, 'edits.0.layer'],
      [{ edits: [{ clipId: S, text: ' ' }] }, 'edits.0.text'],
      [{ edits: [{ clipId: S, volume: 2.1 }] }, 'edits.0.volume'],
      [{ edits: [{ clipId: S, fadeInSec: 31 }] }, 'edits.0.fadeInSec'],
      [{ edits: [{ clipId: S, unsetStyle: ['nope'] }] }, 'edits.0.unsetStyle.0'],
    ],
  },
  remove_telops: {
    base: { projectId: P, clipIds: [S] },
    cases: [
      [{ projectId: 'x' }, 'projectId'],
      [{ clipIds: ['x'] }, 'clipIds.0'],
      [{ clipIds: many(201, S) }, 'clipIds'],
      [{ narrationLineIds: many(201, S) }, 'narrationLineIds'],
    ],
  },
  set_narration: {
    base: { projectId: P, action: 'show' },
    cases: [
      [{ action: 'speak' }, 'action'],
      [{ script: long(20001) }, 'script'],
      [{ voice: '' }, 'voice'],
      [{ lines: [] }, 'lines'],
      [{ lines: [{ lineId: S, text: long(201) }] }, 'lines.0.text'],
      [{ lines: [{ lineId: S, direction: long(201) }] }, 'lines.0.direction'],
      [{ lines: [{ lineId: S, startSec: -1 }] }, 'lines.0.startSec'],
      [{ lineIds: many(1001, S) }, 'lineIds'],
      [{ fromSec: -1 }, 'fromSec'],
      [{ gapSec: 11 }, 'gapSec'],
      [{ readings: { set: [{ written: ' ', reading: 'せんこ' }] } }, 'readings.set.0.written'],
      [{ voiceOptionsFor: 'siri' }, 'voiceOptionsFor'],
    ],
  },
  speak_narration: {
    base: { projectId: P },
    cases: [
      [{ action: 'sing' }, 'action'],
      [{ lineIds: many(1001, S) }, 'lineIds'],
      [{ filePath: 'a.wav' }, 'filePath'],
      [{ mediaAssetId: 'x' }, 'mediaAssetId'],
      [{ voice: '' }, 'voice'],
      [{ placeAtSec: -1 }, 'placeAtSec'],
    ],
  },
  set_lyrics: {
    base: { projectId: P },
    cases: [
      [{ lyrics: long(20001) }, 'lyrics'],
      [{ lyricCues: [-1] }, 'lyricCues.0'],
      [{ lyricCues: many(1001, 0) }, 'lyricCues'],
      [{ instrumental: 'no' }, 'instrumental'],
      [{ placeTelops: 'yes' }, 'placeTelops'],
    ],
  },
  upload_sfx: {
    base: { projectId: P, filePath: '/a/b.wav' },
    cases: [
      [{ filePath: 'b.wav' }, 'filePath'],
      [{ title: ' ' }, 'title'],
      [{ title: long(201) }, 'title'],
      [{ placeAtSec: -1 }, 'placeAtSec'],
      [{ volume: 2.1 }, 'volume'],
    ],
  },
  edit_audio: {
    base: { projectId: P },
    cases: [
      [{ music: { musicTrackId: 'x' } }, 'music.musicTrackId'],
      [{ music: { volume: 2.1 } }, 'music.volume'],
      [{ music: { fadeInSec: 31 } }, 'music.fadeInSec'],
      [{ music: { endSec: 0 } }, 'music.endSec'],
      [{ music: { title: '別名' } }, 'music'],
      [{ ducking: { depthDb: 25 } }, 'ducking.depthDb'],
      [{ ducking: { releaseSec: 3 } }, 'ducking.releaseSec'],
      [{ telopHighlight: { color: 'red' } }, 'telopHighlight.color'],
    ],
  },
  list_edits: {
    base: { projectId: P },
    cases: [
      [{ limit: 0 }, 'limit'],
      [{ limit: 51 }, 'limit'],
      [{ limit: 1.5 }, 'limit'],
    ],
  },
  undo: {
    base: { projectId: P },
    cases: [
      [{ projectId: 'x' }, 'projectId'],
      [{ editBatchId: 'x' }, 'editBatchId'],
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
