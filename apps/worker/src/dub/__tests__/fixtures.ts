import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CharacterId,
  MediaAsset,
  MediaAssetId,
  ProjectId,
  WorkspaceId,
  newId,
  type Character,
  type DialogueLine,
  type DubJob,
  type Project,
  type Shot,
  type Take,
  type VoiceProfile,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryCharacterRepository,
  createInMemoryDubJobRepository,
  createInMemoryMediaAssetRepository,
  createInMemoryProjectClipLock,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryTtsClipRepository,
  createInMemoryVoiceProfileRepository,
} from '@ixa/generation/testing'
import { runFfmpeg } from '@ixa/media'
import type { SpeakRequest, SpeakResult, VoiceAdapter } from '@ixa/provider-core'
import { createMemoryStorage, type ObjectStorage } from '@ixa/storage'
import { aProject, createRecordingEvents, createRecordingMediaQueue, silentLogger } from '../../generation/__tests__/doubles.js'
import type { DubProcessorDeps } from '../deps.js'

/**
 * 声の差し替えの通しのテストの道具。**実 ffmpeg** で、合成した音付きの動画と偽の読み上げを作る。
 * 元の声は 300Hz（0.5〜1.2 秒と 1.8〜2.4 秒）、環境音は 3000Hz、読み上げは 500Hz（頭と尻に 0.2 秒の無音）。
 */

export const KEY_LABEL = 'key2-2026-10-14'

/** 偽の読み上げの長さ（秒）。文の頭の字で決める（読み方を変えても同じ長さ）。 */
const ttsLengthOf = (text: string): number => {
  if (text.startsWith('ながい')) return 2.2
  if (text.startsWith('こんにちは')) return 0.75
  if (text.startsWith('やあ')) return 0.62
  return 0.5
}

export type FakeTts = VoiceAdapter & { readonly calls: () => readonly SpeakRequest[] }

export const createFakeTts = (): FakeTts => {
  let calls: readonly SpeakRequest[] = []
  return {
    tool: 'gemini_api',
    models: [{ id: 'gemini-3.8-flash-tts', label: 'Gemini' }],
    listVoices: () => Promise.resolve([]),
    calls: () => calls,
    speak: async (request): Promise<SpeakResult> => {
      calls = [...calls, request]
      const length = ttsLengthOf(request.text)
      const audioPath = `${request.outputBasePath}.wav`
      const expr = `0.1*sin(2*PI*500*t)*between(t,0.2,${(0.2 + length).toFixed(3)})`
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=24000:d=${(length + 0.4).toFixed(3)}`, '-c:a', 'pcm_s16le', audioPath])
      return { audioPath, charTimes: null, costUsd: 0.001, record: { tool: 'gemini_api' } }
    },
  }
}

const SOURCE_EXPR = '0.2*sin(2*PI*300*t)*(between(t,0.5,1.2)+between(t,1.8,2.4))+0.004*sin(2*PI*3000*t)'

/** 音付き（または音なし）の 3 秒の動画を作り、バイト列を返す。 */
export const makeSourceVideo = async (dir: string, options: { readonly audio: boolean }): Promise<Uint8Array> => {
  const path = join(dir, options.audio ? 'source.mp4' : 'silent.mp4')
  const audio = options.audio ? ['-f', 'lavfi', '-i', `aevalsrc='${SOURCE_EXPR}|${SOURCE_EXPR}':s=48000:d=3`] : []
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=24:duration=3', ...audio,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    ...(options.audio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
    path,
  ])
  return readFile(path)
}

export const createWorkDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'ixa-dub-test-'))
export const removeWorkDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true })

const CAT = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
const MOUSE = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB2')

export const line = (speakerId: CharacterId, text: string, dub?: DialogueLine['dub']): DialogueLine => ({
  speakerId,
  text,
  offscreen: false,
  translation: null,
  ...(dub === undefined ? {} : { dub }),
})

export type DubWorld = {
  readonly deps: DubProcessorDeps
  readonly project: Project
  readonly shot: Shot
  readonly source: Take
  readonly tts: FakeTts
  readonly storage: ObjectStorage
  readonly ids: { readonly cat: CharacterId; readonly mouse: CharacterId }
  readonly shots: ReturnType<typeof createInMemoryShotRepository>
  readonly takes: ReturnType<typeof createInMemoryTakeRepository>
  readonly dubJobs: ReturnType<typeof createInMemoryDubJobRepository>
  readonly ttsClips: ReturnType<typeof createInMemoryTtsClipRepository>
  readonly timelineClips: ReturnType<typeof createInMemoryTimelineClipRepository>
  readonly mediaQueue: ReturnType<typeof createRecordingMediaQueue>
  readonly mediaAssets: ReturnType<typeof createInMemoryMediaAssetRepository>
  readonly newJob: () => Promise<DubJob>
}

const aCharacter = (project: Project, id: CharacterId, displayName: string, speakerNo: number, voice: VoiceProfile | null, levelDb = 0): Character => ({
  id,
  workspaceId: project.workspaceId,
  projectId: project.id,
  name: displayName,
  displayName,
  description: '',
  identityAnchors: [],
  styleTokens: [],
  colorPalette: [],
  speakerNo,
  speechName: null,
  voiceDescription: null,
  dialogueVoiceProfileId: voice?.id ?? null,
  dialogueLevelDb: levelDb,
  createdAt: new Date(0),
})

export const createDubWorld = async (input: {
  readonly workDir: string
  readonly video: Uint8Array
  readonly dialogue?: (ids: { readonly cat: CharacterId; readonly mouse: CharacterId }) => readonly DialogueLine[]
  readonly designedKeyLabel?: string
  readonly mouseHasVoice?: boolean
  /** 前からある素材と Take（作品の複製で写したものなど。別の Shot・別の作品のもの）。 */
  readonly seed?: { readonly assets: readonly MediaAsset[]; readonly takes: readonly Take[] }
}): Promise<DubWorld> => {
  const project = { ...aProject(), id: newId(ProjectId), workspaceId: newId(WorkspaceId) }
  const storage = createMemoryStorage()
  const voices = createInMemoryVoiceProfileRepository()
  const voiceOf = (name: string, designed: boolean) =>
    voices.create({
      projectId: project.id,
      name,
      tool: 'gemini_api',
      model: 'gemini-3.8-flash-tts',
      voiceName: designed ? 'voice_abc123' : 'Kore',
      ...(designed ? { designedVoice: { description: 'やわらかい声', gender: 'female' as const, keyLabel: input.designedKeyLabel ?? KEY_LABEL } } : {}),
    })
  const catVoice = await voiceOf('ネコの声', true)
  const mouseVoice = input.mouseHasVoice === false ? null : await voiceOf('ネズミの声', false)
  const characters = createInMemoryCharacterRepository([
    aCharacter(project, CAT, 'ネコ', 1, catVoice),
    aCharacter(project, MOUSE, 'ネズミ', 2, mouseVoice, -6),
  ])
  const ids = { cat: CAT, mouse: MOUSE }
  const dialogue = input.dialogue?.(ids) ?? [line(CAT, 'こんにちは、ネズミくん。'), line(MOUSE, 'やあ。')]
  const baseShot = aShot(project.id, { startSec: 10, durationSec: 3, dialogue: [...dialogue] })
  const assetId = newId(MediaAssetId)
  const source = aTake(baseShot, 'a'.repeat(64), { mediaAssetId: assetId })
  const storageKey = `media/${project.workspaceId}/${assetId}/original.mp4`
  await storage.put(storageKey, input.video, { contentType: 'video/mp4' })
  const asset = MediaAsset.parse({
    id: assetId,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'video',
    storageKey,
    mimeType: 'video/mp4',
    bytes: input.video.byteLength,
    checksumSha256: createHash('sha256').update(input.video).digest('hex'),
    probe: { durationSec: 3, width: 160, height: 120, fps: 24, hasAudio: true, codec: 'h264' },
    proxyKey: null,
    thumbnailKey: null,
    origin: { type: 'generated', takeId: source.id },
    createdAt: new Date(0),
  })
  const shot = { ...baseShot, selectedTakeId: source.id, status: 'review' as const }
  const shots = createInMemoryShotRepository([shot])
  const takes = createInMemoryTakeRepository([source, ...(input.seed?.takes ?? [])])
  const mediaAssets = createInMemoryMediaAssetRepository([asset, ...(input.seed?.assets ?? [])])
  const timelineClips = createInMemoryTimelineClipRepository([])
  const dubJobs = createInMemoryDubJobRepository()
  const ttsClips = createInMemoryTtsClipRepository()
  const mediaQueue = createRecordingMediaQueue()
  const tts = createFakeTts()
  const deps: DubProcessorDeps = {
    dubJobs,
    ttsClips,
    shots,
    projects: { findById: (id) => Promise.resolve(id === project.id ? project : null) },
    characters,
    voices,
    takes,
    mediaAssets,
    storage,
    voiceAdapter: (tool) => (tool === 'gemini_api' ? tts : null),
    keyLabel: KEY_LABEL,
    mediaQueue,
    clipLock: createInMemoryProjectClipLock(timelineClips),
    events: createRecordingEvents(),
    workDir: input.workDir,
    logger: silentLogger,
  }
  return {
    deps,
    project,
    shot,
    source,
    tts,
    storage,
    ids,
    shots,
    takes,
    dubJobs,
    ttsClips,
    timelineClips,
    mediaQueue,
    mediaAssets,
    newJob: () => dubJobs.create({ projectId: project.id, shotId: shot.id, sourceTakeId: source.id }),
  }
}
