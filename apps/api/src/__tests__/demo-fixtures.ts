import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MediaAssetId as MediaAssetIdSchema,
  MusicAnalysis,
  MusicAnalysisId,
  VoiceJobId,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAssetId,
  type MediaKind,
  type Project,
  type WorkspaceId,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryNarrationLineRepository,
  createInMemoryNarrationTakeRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
  createInMemoryVoiceProfileRepository,
} from '@ixa/generation/testing'
import { runFfmpeg } from '@ixa/media'
import { createMemoryStorage, mediaKey, waveformKey, type ObjectStorage } from '@ixa/storage'
import { createLogger } from '../logger.js'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import { exportDemo } from '../demo-project/exporter.js'
import { baseAppDeps } from './app-deps.js'

/**
 * 見本（ADR-0067）の試験の道具。**素材は ffmpeg でその場で作る**（バイナリを git に入れない。
 * `packages/media/src/__tests__/fixtures.ts` と同じ方針）。
 *
 * - `aWorld` … 作品を書ける一揃い（複製と同じ書き手の口と、素材の表・置き場）
 * - `seedCreatorProject` … 作る人の作品（曲と解析の波形・キャラクターと Look・Shot 2 つ・採用した Take・テロップ・声）
 * - `exportToDir` … 作品を書き出してフォルダに置く（`DEMO_DIR` の形）
 */

export const DEMO_BASE_URL = 'https://github.com/kabatin/ixa-video-creator/releases/download/demo-v1/'

export const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export const makeTempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'ixa-demo-test-'))
export const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true })

/** ffmpeg で小さな素材を作り、中身を返す（`variant` で中身を変える。同じ中身は同じ素材になるため）。 */
export const makeMediaBytes = async (dir: string, kind: 'image' | 'video' | 'audio', variant: number): Promise<Uint8Array> => {
  const out = join(dir, `${kind}-${String(variant)}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`)
  const color = ['red', 'blue', 'green', 'yellow'][variant % 4] ?? 'red'
  const args =
    kind === 'image'
      ? ['-f', 'lavfi', '-i', `color=c=${color}:s=32x18`, '-frames:v', '1']
      : kind === 'video'
        ? ['-f', 'lavfi', '-i', `color=c=${color}:s=32x18:r=10:d=0.5`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an']
        : ['-f', 'lavfi', '-i', `sine=frequency=${String(220 * (variant + 1))}:sample_rate=8000:duration=0.5`]
  await runFfmpeg(['-y', '-loglevel', 'error', ...args, out])
  return readFile(out)
}

const CONTENT_TYPES = { image: 'image/png', video: 'video/mp4', audio: 'audio/wav' } as const
const EXTENSIONS = { image: 'png', video: 'mp4', audio: 'wav' } as const

export type DemoWorld = ReturnType<typeof aWorld>

/** 作品を書ける一揃い。作る人の機械と、入れる人の機械を別々に作れる。 */
export const aWorld = () => {
  const base = baseAppDeps()
  const storage: ObjectStorage = createMemoryStorage()
  const writers = {
    ...base,
    shots: createInMemoryShotRepository(),
    takes: createInMemoryTakeRepository(),
    voices: createInMemoryVoiceProfileRepository(),
    narrationLines: createInMemoryNarrationLineRepository(),
    narrationTakes: createInMemoryNarrationTakeRepository(),
    syncDialogueTelops: () => Promise.resolve(),
    logger: createLogger('silent'),
  }
  // 複製と同じ書き手の口として渡せる（足りない口があればここで型が落ちる）。
  const asDuplicationDeps: ProjectDuplicationDeps = writers
  void asDuplicationDeps
  return { writers, storage, mediaAssets: base.mediaAssets, workspaceId: newId(WorkspaceIdSchema) }
}

/** 作る人の機械に素材を 1 つ置く（置き場と素材の表）。 */
const putMedia = async (world: DemoWorld, kind: MediaKind & keyof typeof CONTENT_TYPES, bytes: Uint8Array): Promise<MediaAssetId> => {
  const id = newId(MediaAssetIdSchema)
  const storageKey = mediaKey(world.workspaceId, id, EXTENSIONS[kind])
  await world.storage.put(storageKey, bytes, { contentType: CONTENT_TYPES[kind] })
  await world.mediaAssets.create({
    id,
    workspaceId: world.workspaceId,
    projectId: null,
    kind,
    storageKey,
    mimeType: CONTENT_TYPES[kind],
    bytes: bytes.byteLength,
    checksumSha256: sha256Of(bytes),
    origin: { type: 'upload', uploadedBy: 'test' },
    tags: [],
  })
  return id
}

export type CreatorProject = Awaited<ReturnType<typeof seedCreatorProject>>

/** 作る人の作品。曲（解析と波形）・キャラクター（Look と画像）・Shot 2 つ（採用・外した Take・最初のフレーム）・テロップ・声。 */
export const seedCreatorProject = async (world: DemoWorld, mediaDir: string) => {
  const w = world.writers
  const [image1, image2, video1, video2, video3, audio, voiceAudio] = await Promise.all([
    makeMediaBytes(mediaDir, 'image', 0).then((b) => putMedia(world, 'image', b)),
    makeMediaBytes(mediaDir, 'image', 1).then((b) => putMedia(world, 'image', b)),
    makeMediaBytes(mediaDir, 'video', 0).then((b) => putMedia(world, 'video', b)),
    makeMediaBytes(mediaDir, 'video', 1).then((b) => putMedia(world, 'video', b)),
    makeMediaBytes(mediaDir, 'video', 2).then((b) => putMedia(world, 'video', b)),
    makeMediaBytes(mediaDir, 'audio', 0).then((b) => putMedia(world, 'audio', b)),
    makeMediaBytes(mediaDir, 'audio', 1).then((b) => putMedia(world, 'audio', b)),
  ])
  const created = await w.projects.create({
    workspaceId: world.workspaceId,
    name: '作る人の作品',
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    styleGuide: '水彩のアニメ調',
  })
  const project: Project = await w.projects.update(created.id, {
    styleReferenceAssetIds: [image1],
    lyrics: '一行目',
    lyricCues: [0.5],
    durationSec: 30,
  })
  const script = await w.scripts.ensureForProject(project.id)
  await w.scripts.appendVersion({ scriptId: script.id, content: '夜の街を走る', authoredBy: 'human' })

  const track = await w.musicTracks.create({ projectId: project.id, mediaAssetId: audio, title: '見本の曲', isMaster: true, offsetSec: 0, volume: 1 })
  const peaksKey = waveformKey(project.id, track.id)
  await world.storage.put(peaksKey, new TextEncoder().encode('{"peaks":[0.1,0.5,0.2]}'), { contentType: 'application/json' })
  await w.musicAnalyses.create(
    MusicAnalysis.parse({
      id: newId(MusicAnalysisId),
      musicTrackId: track.id,
      analyzerVersion: 'librosa-v1',
      durationSec: 30,
      bpm: 120,
      bpmConfidence: 0.9,
      beats: [0, 0.5, 1],
      downbeats: [0],
      sections: [{ start: 0, end: 30, label: 'intro', energy: 0.4 }],
      energyCurve: { hopSec: 0.1, values: [0.1, 0.2] },
      onsets: [],
      drops: [],
      waveformPeaksKey: peaksKey,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
  )

  const character = await w.characters.create({ workspaceId: world.workspaceId, projectId: project.id, name: 'runner', displayName: '走る子' })
  await w.characters.addIdentityImage({ characterId: character.id, mediaAssetId: image2, role: 'four_view', isPrimary: true, order: 0 })
  const look = await w.looks.create({ characterId: character.id, key: 'BASE', name: '基本', isDefault: true, canonicalFrameAssetId: image2 })
  await w.looks.addLookImage({ lookId: look.id, mediaAssetId: image1, role: 'wardrobe', isPrimary: true, order: 0 })
  const location = await w.locations.create({ workspaceId: world.workspaceId, projectId: project.id, name: '街', description: '', referenceAssetIds: [image1] })

  const shotA = aShot(project.id, { code: 'CUT-01', order: 1000, startSec: 0, durationSec: 2, description: '走り出す', locationId: location.id })
  const shotB = aShot(project.id, { code: 'CUT-02', order: 2000, startSec: 2, durationSec: 2, description: '振り返る' })
  const [a, b] = await w.shots.createMany([shotA, shotB])
  if (a === undefined || b === undefined) throw new Error('Shot を作れませんでした')
  const takeA1 = await w.takes.create({ ...aTake(a, 'a'.repeat(64), { index: 1, mediaAssetId: video1 }) })
  const takeA2 = await w.takes.create({ ...aTake(a, 'b'.repeat(64), { index: 2, mediaAssetId: video2, parentTakeId: takeA1.id }) })
  const takeB1 = await w.takes.create({ ...aTake(b, 'c'.repeat(64), { index: 1, mediaAssetId: video3 }) })
  await w.takes.hide(takeA1.id, new Date('2026-01-03T00:00:00.000Z'))
  await w.shots.selectTake(a.id, takeA2.id)
  await w.shots.selectTake(b.id, takeB1.id)
  await w.shotCharacters.replaceAll(a.id, [{ characterId: character.id, lookId: look.id, prominence: 'primary', order: 0 }])
  await w.shotReferences.create({ shotId: a.id, mediaAssetId: image1, role: 'start_frame', weight: 1, order: 0, sourceKind: 'manual' })
  await w.transitions.create({ projectId: project.id, fromShotId: a.id, toShotId: b.id, type: 'dissolve', durationSec: 0.5 })

  const style = await w.textStyles.create(project.id, { name: '題名', style: { size: 0.1 } })
  await w.timelineClips.create({
    projectId: project.id,
    track: 'TEXT',
    startSec: 0,
    durationSec: 2,
    content: { type: 'text', templateKey: 'plain', params: { text: '見本の題名', styleId: style.id } },
  })
  const voice = await w.voices.create({ projectId: project.id, name: '語り', tool: 'macos_say', voiceName: 'Kyoko', textStyleId: style.id })
  const [line] = await w.narrationLines.createMany([{ projectId: project.id, order: 0, text: '走れ。', voiceProfileId: voice.id, startSec: 1 }])
  if (line === undefined) throw new Error('原稿の行を作れませんでした')
  const narrationTake = await w.narrationTakes.create({
    lineId: line.id,
    source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'macos_say', model: null, voiceName: 'Kyoko' },
    mediaAssetId: voiceAudio,
    inSec: 0,
    outSec: 0.5,
    spokenText: '走れ。',
    displayText: '走れ。',
    specHash: 'abc',
    charTimes: null,
    loudnessLufs: -16,
    peaks: [0.2, 0.8],
    costUsd: 0,
  })
  await w.narrationLines.update(line.id, { selectedTakeId: narrationTake.id })
  return { project, media: { image1, image2, video1, video2, video3, audio, voiceAudio }, peaksKey, shots: { a, b } }
}

/** 作品を書き出し、フォルダ（`DEMO_DIR` の形）に置く。 */
export const exportToDir = async (world: DemoWorld, project: Project, dir: string, overrides: {
    readonly title?: string
    readonly secrets?: readonly string[]
    readonly machine?: { readonly homeDir: string; readonly userName: string }
  } = {}) => {
  await mkdir(dir, { recursive: true })
  const manifest = await exportDemo(
    {
      ...world.writers,
      mediaAssets: world.mediaAssets,
      storage: world.storage,
      writeOut: (name, bytes) => writeFile(join(dir, name), bytes),
      secrets: overrides.secrets ?? [],
      // 試験の機械（実際のホームに頼らない）。
      machine: overrides.machine ?? { homeDir: '/Users/demo-maker', userName: 'demo-maker' },
    },
    { projectId: project.id, demoKey: 'ixa-demo-v1', baseUrl: DEMO_BASE_URL, title: overrides.title ?? '見本の作品' },
  )
  return manifest
}

export const otherWorkspace = (): WorkspaceId => newId(WorkspaceIdSchema)
