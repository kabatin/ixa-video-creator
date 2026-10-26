import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MediaAssetId as MediaAssetIdSchema, newId, type DubJobId, type Project, type VoiceProfile } from '@ixa/domain'
import { probeMedia } from '@ixa/media'
import { GEMINI_DEFAULT_TTS_MODEL } from '@ixa/provider-voice'
import { mediaKey } from '@ixa/storage'
import { DubFailure, type DubProcessorDeps } from './deps.js'

/**
 * 読み上げを保存して使い回す（ADR-0062）。**声・読み方・文が同じなら読み直さない**
 * （音量や置き方だけ変えてやり直しても、読み上げの費用は掛からない）。
 * 鍵は sha256(モデル・声・読み方の指示・速さ・文)。API キーは入れない。
 */

export type TtsReading = {
  /** 手元に置いた読み上げ（WAV）。 */
  readonly path: string
  /** 今回払った額（使い回したときは 0）。 */
  readonly costUsd: number
  readonly cached: boolean
}

export type TtsRequest = {
  readonly voice: VoiceProfile
  /** 行ごとの読み方の指示（`dub.style`）。無ければ空。 */
  readonly direction: string
  readonly text: string
}

const modelOf = (voice: VoiceProfile): string => voice.model ?? GEMINI_DEFAULT_TTS_MODEL

export const ttsCacheKey = (request: TtsRequest): string =>
  createHash('sha256')
    .update(
      JSON.stringify([modelOf(request.voice), request.voice.voiceName, request.voice.styleNote, request.direction, request.voice.speed, request.text]),
    )
    .digest('hex')

const fromCache = async (deps: DubProcessorDeps, cacheKey: string, path: string): Promise<TtsReading | null> => {
  const clip = await deps.ttsClips.findByKey(cacheKey)
  if (clip === null) return null
  const asset = await deps.mediaAssets.findById(clip.mediaAssetId)
  if (asset === null) return null
  await writeFile(path, await deps.storage.get(asset.storageKey))
  return { path, costUsd: 0, cached: true }
}

/** 読み上げを素材にして保存する。同じ中身の素材が既にあればそれを指す。 */
const remember = async (
  deps: DubProcessorDeps,
  context: { readonly project: Project; readonly dubJobId: DubJobId },
  cacheKey: string,
  path: string,
  costUsd: number,
): Promise<void> => {
  const body = await readFile(path)
  const checksumSha256 = createHash('sha256').update(body).digest('hex')
  const durationSec = (await probeMedia(path)).durationSec ?? 0
  if (!(durationSec > 0)) throw new DubFailure('tts_empty', '読み上げが空でした。もう一度差し替えてください', { retryable: true })
  const existing = await deps.mediaAssets.findByChecksum(checksumSha256)
  const mediaAssetId =
    existing?.id ??
    (await (async () => {
      const id = newId(MediaAssetIdSchema)
      const storageKey = mediaKey(context.project.workspaceId, id, 'wav')
      await deps.storage.put(storageKey, body, { contentType: 'audio/wav' })
      await deps.mediaAssets.create({
        id,
        workspaceId: context.project.workspaceId,
        projectId: context.project.id,
        kind: 'audio',
        storageKey,
        mimeType: 'audio/wav',
        bytes: body.byteLength,
        checksumSha256,
        origin: { type: 'generated_dub', dubJobId: context.dubJobId },
      })
      return id
    })())
  await deps.ttsClips.save({ cacheKey, mediaAssetId, durationSec, costUsd })
}

/** 保存してあればそれを、無ければ読み上げて保存する。`name` は作業用のファイル名（拡張子なし）。 */
export const readAloud = async (
  deps: DubProcessorDeps,
  context: { readonly project: Project; readonly dubJobId: DubJobId; readonly workDir: string },
  request: TtsRequest,
  name: string,
): Promise<TtsReading> => {
  const cacheKey = ttsCacheKey(request)
  const cached = await fromCache(deps, cacheKey, join(context.workDir, `${name}.cached.wav`))
  if (cached !== null) return cached
  const adapter = deps.voiceAdapter(request.voice.tool)
  if (adapter === null) {
    throw new DubFailure('voice_unavailable', 'Gemini の声が使えません。使う AI の設定（Gemini の鍵）を確かめてください')
  }
  const result = await adapter.speak({
    text: request.text,
    model: modelOf(request.voice),
    voiceName: request.voice.voiceName,
    styleNote: request.voice.styleNote,
    direction: request.direction,
    speed: request.voice.speed,
    tuning: request.voice.tuning,
    language: request.voice.language,
    outputBasePath: join(context.workDir, name),
  })
  await remember(deps, context, cacheKey, result.audioPath, result.costUsd)
  return { path: result.audioPath, costUsd: result.costUsd, cached: false }
}
