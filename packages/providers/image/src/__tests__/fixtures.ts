import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MediaAssetId, ModelId, ProviderId } from '@ixa/domain'
import { runFfmpeg } from '@ixa/media'
import type {
  ImageGenerationRequest,
  ImageJobStatus,
  ImageModelDescriptor,
  ImageProvider,
  ProviderJobHandle,
} from '@ixa/provider-core'

export const createTempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'ixa-stub-image-'))

export const removeTempDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true })

export const modelId = (s: string): ModelId => ModelId.parse(s)
export const providerId = (s: string): ProviderId => ProviderId.parse(s)
export const assetId = (s = '01ARZ3NDEKTSV4RRFFQ69G5FAV'): MediaAssetId => MediaAssetId.parse(s)

/** テスト用。id / providerId は素の文字列で渡し、ここで branded 型へ変換する。 */
export type ImageModelOverrides = Omit<Partial<ImageModelDescriptor>, 'id' | 'providerId'> & {
  id: string
  providerId?: string
}

export const makeImageModel = (overrides: ImageModelOverrides): ImageModelDescriptor => ({
  id: modelId(overrides.id),
  providerId: providerId(overrides.providerId ?? 'test'),
  label: overrides.label ?? overrides.id,
  capabilities: {
    referenceImages: { max: 14, roles: ['subject', 'wardrobe', 'location', 'style'] },
    resolutions: [{ width: 1024, height: 1024 }],
    aspectRatios: ['1:1'],
    maskEdit: false,
    seed: true,
    negativePrompt: false,
    ...overrides.capabilities,
  },
  qualities: {
    characterConsistency: 0.7,
    promptAdherence: 0.7,
    textRendering: 0.7,
    ...overrides.qualities,
  },
  economics: { costPerImageUsd: 0.04, typicalLatencySec: 10, ...overrides.economics },
})

/** スタブは参照画像を絵に反映しないため、解決関数は呼ばれない想定。呼ばれたら失敗させる。 */
const rejectReference = (id: MediaAssetId): Promise<string> =>
  Promise.reject(new Error(`参照 ${id} は解決されないはずです`))

export const makeImageRequest = (
  model: ImageModelDescriptor,
  overrides: Partial<Omit<ImageGenerationRequest, 'model'>> = {},
): ImageGenerationRequest => ({
  model,
  prompt: 'takepi の四面図 turnaround sheet',
  negativePrompt: null,
  resolution: { width: 1024, height: 1024 },
  aspectRatio: '1:1',
  seed: null,
  references: [],
  resolveReference: rejectReference,
  count: 1,
  ...overrides,
})

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export type SucceededImageStatus = Extract<ImageJobStatus, { state: 'succeeded' }>

/** 実 Provider と同じくポーリングで完了を待つ。 */
export const pollUntilSettled = async (
  provider: ImageProvider,
  handle: ProviderJobHandle,
  timeoutMs = 120_000,
): Promise<ImageJobStatus> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await provider.poll(handle)
    if (status.state === 'succeeded' || status.state === 'failed') return status
    if (Date.now() > deadline) throw new Error(`ジョブ ${handle.ref} が ${timeoutMs}ms で終わらない`)
    await sleep(50)
  }
}

export const pollUntilSucceeded = async (
  provider: ImageProvider,
  handle: ProviderJobHandle,
  timeoutMs = 120_000,
): Promise<SucceededImageStatus> => {
  const status = await pollUntilSettled(provider, handle, timeoutMs)
  if (status.state !== 'succeeded') {
    throw new Error(`生成に失敗しました: ${JSON.stringify(status)}`)
  }
  return status
}

/** succeeded 状態からローカル出力パスを取り出す。スタブは常に local を返す。 */
export const localPathsOf = (status: SucceededImageStatus): readonly string[] =>
  status.outputs.map((output) => {
    if (output.type !== 'local') throw new Error('スタブは local 出力を返すはずです')
    return output.path
  })

export type Rgb = { readonly r: number; readonly g: number; readonly b: number }

/**
 * 画像の指定位置から 16x16 を切り出し、平均 1 ピクセルにして色を取り出す。
 * プロンプトごとに背景色が決まっていることを、実際の画像で確かめるために使う。
 */
export const samplePixelAt = async (
  imagePath: string,
  workDir: string,
  x: number,
  y: number,
): Promise<Rgb> => {
  const rawPath = join(workDir, `pixel-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg([
    '-y',
    '-i',
    imagePath,
    '-vf',
    `crop=16:16:${x}:${y},scale=1:1`,
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
    throw new Error(`ピクセルを取り出せませんでした: ${imagePath}`)
  }
  return { r, g, b }
}

/** `#RRGGBB` を RGB に分解する。生成画像の色が関数の出力と一致するかを確かめるために使う。 */
export const hexToRgb = (hex: string): Rgb => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
})

export const channelDistance = (a: Rgb, b: Rgb): number =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))

export const sha256OfFile = async (path: string): Promise<string> => {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}
