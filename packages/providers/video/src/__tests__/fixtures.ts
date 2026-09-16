import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ShotId } from '@ixa/domain'
import type { MediaAssetId, ShotGenerationSpec } from '@ixa/domain'
import { runFfmpeg } from '@ixa/media'
import type {
  ProviderJobHandle,
  ProviderJobStatus,
  VideoGenerationRequest,
  VideoModelDescriptor,
  VideoProvider,
} from '@ixa/provider-core'

export const createTempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'ixa-stub-video-'))

export const removeTempDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true })

export const SHOT_ID_A = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')
export const SHOT_ID_B = ShotId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ')

export const makeSpec = (overrides: Partial<ShotGenerationSpec> = {}): ShotGenerationSpec => ({
  specVersion: 1,
  shotId: SHOT_ID_A,
  sourceType: 'ai_video',
  prompt: 'takepi が勝利する',
  negativePrompt: null,
  promptParts: {
    styleGuide: '',
    shotDescription: 'takepi が勝利する',
    identityAnchors: [],
    styleTokens: [],
    colorPalette: [],
    wardrobeTokens: [],
    cameraFragment: 'medium closeup',
    moodFragment: null,
  },
  durationSec: 4,
  aspectRatio: '16:9',
  resolution: { width: 1280, height: 720 },
  fps: 24,
  seed: null,
  references: [],
  camera: {
    size: 'medium_closeup',
    angleH: null,
    angle: null,
    lensMm: null,
    movement: null,
    movementIntensity: null,
  },
  ...overrides,
})

/** スタブは参照画像を絵に反映しないため、解決関数は呼ばれない想定。呼ばれたら失敗させる。 */
const rejectReference = (id: MediaAssetId): Promise<string> =>
  Promise.reject(new Error(`参照 ${id} は解決されないはずです`))

export const makeRequest = (
  model: VideoModelDescriptor,
  spec: ShotGenerationSpec,
): VideoGenerationRequest => ({ model, spec, resolveReference: rejectReference })

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export type SucceededStatus = Extract<ProviderJobStatus, { state: 'succeeded' }>

/** 実 Provider と同じくポーリングで完了を待つ。 */
export const pollUntilSettled = async (
  provider: VideoProvider,
  handle: ProviderJobHandle,
  timeoutMs = 120_000,
): Promise<ProviderJobStatus> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await provider.poll(handle)
    if (status.state === 'succeeded' || status.state === 'failed') return status
    if (Date.now() > deadline) throw new Error(`ジョブ ${handle.ref} が ${timeoutMs}ms で終わらない`)
    await sleep(50)
  }
}

export const pollUntilSucceeded = async (
  provider: VideoProvider,
  handle: ProviderJobHandle,
  timeoutMs = 120_000,
): Promise<SucceededStatus> => {
  const status = await pollUntilSettled(provider, handle, timeoutMs)
  if (status.state !== 'succeeded') {
    throw new Error(`生成に失敗しました: ${JSON.stringify(status)}`)
  }
  return status
}

export type Rgb = { readonly r: number; readonly g: number; readonly b: number }

/**
 * 動画の右上（テキストが無い領域）から 1 ピクセル取り出す。
 * 背景色が shotId ごとに決まっていることを、実際の映像で確かめるために使う。
 */
export const samplePixel = async (videoPath: string, workDir: string): Promise<Rgb> => {
  const rawPath = join(workDir, `pixel-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg([
    '-y',
    '-i',
    videoPath,
    '-vf',
    'crop=16:16:in_w-32:8,scale=1:1',
    '-frames:v',
    '1',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    rawPath,
  ])
  const bytes = await readFile(rawPath)
  const [r, g, b] = [bytes[0], bytes[1], bytes[2]]
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`ピクセルを取り出せませんでした: ${videoPath}`)
  }
  return { r, g, b }
}

export const channelDistance = (a: Rgb, b: Rgb): number =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))

export const filePathFromUrl = (fileUrl: string): string => fileURLToPath(fileUrl)
