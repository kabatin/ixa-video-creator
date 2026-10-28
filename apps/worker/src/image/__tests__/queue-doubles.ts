import type { AiSettings, AiToolId, ImageCheckResult, ImageGenerationJobId } from '@ixa/domain'
import { createInMemoryImageCheckRepository } from '@ixa/generation/testing'
import type { ImageCheckRequest, ImageChecker } from '@ixa/provider-llm'
import { processImageJob, type ImageJobResult, type ImageProcessorDeps } from '../processor.js'

/**
 * 作った絵のチェック（ADR-0055）の偽物と、image キューを手で回す口。
 * 描く手順はチェックの手順を積んで終わるので、テストは積まれたものを同じ材料で最後まで回す（`runImageJob`）。
 */

export type RecordingImageQueue = ImageProcessorDeps['queue'] & {
  readonly pending: { imageJobId: ImageGenerationJobId; step?: 'check' }[]
}

export const recordingImageQueue = (): RecordingImageQueue => {
  const pending: { imageJobId: ImageGenerationJobId; step?: 'check' }[] = []
  return {
    pending,
    draw: (imageJobId) => {
      pending.push({ imageJobId })
      return Promise.resolve()
    },
    check: (imageJobId) => {
      pending.push({ imageJobId, step: 'check' })
      return Promise.resolve()
    },
  }
}

export type FakeImageChecker = ImageChecker & { readonly calls: ImageCheckRequest[] }

/** 呼ばれた順に `results` を返す（尽きたら最後のものを返し続ける）。 */
export const fakeImageChecker = (results: readonly ImageCheckResult[], costUsd = 0.02): FakeImageChecker => {
  const calls: ImageCheckRequest[] = []
  return {
    name: 'fake-image-checker',
    calls,
    check: (request) => {
      calls.push(request)
      const result = results[Math.min(calls.length - 1, results.length - 1)]
      return result === undefined ? Promise.reject(new Error('答えがありません')) : Promise.resolve({ result, costUsd })
    },
  }
}

export const PASS: ImageCheckResult = { verdict: 'pass', score: 0.9, issues: [], promptDelta: null }
export const RETRY = (score: number): ImageCheckResult => ({
  verdict: 'retry',
  score,
  issues: [{ kind: 'anatomy', message: '右手の指が 6 本あります' }],
  promptDelta: 'exactly five fingers on each hand',
})

/** 文章の AI と絵のチェック（ADR-0066）。既定は絵のチェックを入れる（チェックの手順を確かめる試験が多いため）。 */
export const checkSettingsOf =
  (text: AiToolId, image = true) =>
  (): Promise<Pick<AiSettings, 'text' | 'checks'>> =>
    Promise.resolve({ text, checks: { image, video: false } })

/** チェックの材料の既定。文章の AI は Claude ではない（チェックを飛ばして今までどおり当てる）。 */
export const checkDeps = () => ({
  imageChecks: createInMemoryImageCheckRepository(),
  checker: fakeImageChecker([PASS]),
  checkSettings: checkSettingsOf('codex_cli'),
  maxRetries: 2,
  queue: recordingImageQueue(),
})

/** 1 つ回し、積まれた手順（チェック・やり直し）を同じ材料で尽きるまで回す。最初の結果を返す。 */
export const runImageJob = async (
  deps: ImageProcessorDeps & { readonly queue: RecordingImageQueue },
  data: { readonly imageJobId: ImageGenerationJobId },
): Promise<ImageJobResult> => {
  const result = await processImageJob(deps, data)
  for (let next = deps.queue.pending.shift(); next !== undefined; next = deps.queue.pending.shift()) {
    await processImageJob(deps, next)
  }
  return result
}
