import { VoiceJobId, newId, type TimelineDocument } from '@ixa/domain'
import {
  createInMemoryAudioSettingsRepository,
  createInMemoryNarrationLineRepository,
  createInMemoryNarrationTakeRepository,
  createInMemoryVoiceProfileRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { timelineRoutes } from '../routes/timeline.js'
import { aProject } from './fixtures.js'
import { aMediaAsset, createInMemoryMusicTrackRepository } from './in-memory-timeline-repositories.js'
import { timelineDeps } from './timeline-deps.js'

/**
 * タイムラインにナレーションを載せる（ADR-0038）。置いて声を選んだ行だけ、声の音を audio に入れる。
 * 声の音量は声（VoiceProfile）の設定。ダッキングの設定も文書に載せる。
 */

type Ok<T> = { success: true; data: T }

describe('GET /projects/:projectId/timeline（ナレーション）', () => {
  it('置いて声を選んだ行だけ、声の音（区間の頭つき）を role: voice で載せる', async () => {
    const project = aProject()
    const asset = aMediaAsset({ workspaceId: project.workspaceId, projectId: project.id, kind: 'audio', storageKey: 'media/ws/voice/original.m4a', mimeType: 'audio/mp4' })
    const narration = {
      voices: createInMemoryVoiceProfileRepository(),
      lines: createInMemoryNarrationLineRepository(),
      takes: createInMemoryNarrationTakeRepository(),
      audioSettings: createInMemoryAudioSettingsRepository(),
    }
    const voice = await narration.voices.create({ projectId: project.id, name: 'ナレーター', tool: 'stub', voiceName: 'stub', volume: 0.9 })
    const [placed, unplaced, silent] = await narration.lines.createMany([
      { projectId: project.id, order: 0, text: '置いた', voiceProfileId: voice.id, startSec: 2 },
      { projectId: project.id, order: 1, text: '置いていない', voiceProfileId: voice.id },
      { projectId: project.id, order: 2, text: '声が無い', voiceProfileId: voice.id, startSec: 6 },
    ])
    if (placed === undefined || unplaced === undefined || silent === undefined) throw new Error('行がありません')
    for (const line of [placed, unplaced]) {
      const take = await narration.takes.create({
        lineId: line.id,
        source: { type: 'recording', voiceJobId: newId(VoiceJobId) },
        mediaAssetId: asset.id,
        inSec: 3,
        outSec: 4.5,
        spokenText: line.text,
        displayText: line.text,
        specHash: null,
        charTimes: null,
        loudnessLufs: -16,
        peaks: null,
        costUsd: 0,
      })
      await narration.lines.update(line.id, { selectedTakeId: take.id })
    }
    const deps = { ...timelineDeps({ project, mediaAssets: [asset] }), narration }

    const response = await timelineRoutes(deps).request(`/projects/${project.id}/timeline`)
    const doc = ((await response.json()) as Ok<TimelineDocument>).data

    const voices = doc.audio.filter((track) => track.role === 'voice')
    expect(voices).toHaveLength(1)
    expect(voices[0]).toMatchObject({ startSec: 2, durationSec: 1.5, inSec: 3, volume: 0.9 })
    expect(voices[0]?.mediaUrl).toMatch(/^memory:\/\/media\/ws\/voice\/original\.m4a/)
    expect(doc.durationSec).toBe(3.5)
    expect(doc.ducking).toEqual({ enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 })
  })

  it('ナレーションの口が無ければ、今までどおり（声も設定も載せない）', async () => {
    const project = aProject()
    const response = await timelineRoutes(timelineDeps({ project })).request(`/projects/${project.id}/timeline`)
    const doc = ((await response.json()) as Ok<TimelineDocument>).data
    expect(doc.audio).toEqual([])
    expect(doc.ducking).toBeUndefined()
  })
})

describe('GET /projects/:projectId/timeline（BGM のフェード。ADR-0039）', () => {
  it('曲のフェードを文書に渡す', async () => {
    const project = aProject()
    const asset = aMediaAsset({ workspaceId: project.workspaceId, projectId: project.id, kind: 'audio', storageKey: 'media/ws/bgm/original.mp3', mimeType: 'audio/mpeg' })
    const musicTracks = createInMemoryMusicTrackRepository()
    await musicTracks.create({ projectId: project.id, mediaAssetId: asset.id, title: 'BGM', isMaster: true, offsetSec: 0, volume: 1, fadeInSec: 2, fadeOutSec: 3 })
    const deps = { ...timelineDeps({ project, mediaAssets: [asset] }), musicTracks }

    const response = await timelineRoutes(deps).request(`/projects/${project.id}/timeline`)
    const doc = ((await response.json()) as Ok<TimelineDocument>).data

    expect(doc.audio[0]).toMatchObject({ fadeInSec: 2, fadeOutSec: 3 })
  })
})
