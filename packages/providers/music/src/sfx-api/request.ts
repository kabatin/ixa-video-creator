import { SFX_PROMPT_MAX_LENGTH } from '@ixa/domain'
import type { SfxGenerationRequest } from '@ixa/provider-core'
import { localServerInputError } from '@ixa/provider-video'
import { SFX_API_IDENTITY, SFX_API_MODELS } from './descriptor.js'

/**
 * 送る前の検査（sfx-api の契約と同じ範囲）。範囲の外をサーバに送ってから 422 で断られないように。
 * 呼ぶ側（`SfxJobSpec`）でも検査しているが、口が増えたときのためにここでも止める。
 */
export const ensureSfxApiRequest = (request: SfxGenerationRequest): void => {
  const fail = (message: string): never => {
    throw localServerInputError(SFX_API_IDENTITY, message)
  }
  const { model } = request
  if (!SFX_API_MODELS.some((known) => known.id === model.id)) fail('知らない効果音のモデルです')
  if (request.prompt.trim() === '') fail('効果音の説明が空です')
  if ([...request.prompt].length > SFX_PROMPT_MAX_LENGTH) {
    fail(`効果音の説明が ${String(SFX_PROMPT_MAX_LENGTH)} 文字を超えています`)
  }
  if (request.negativePrompt !== null && [...request.negativePrompt].length > SFX_PROMPT_MAX_LENGTH) {
    fail(`入れたくない音の説明が ${String(SFX_PROMPT_MAX_LENGTH)} 文字を超えています`)
  }
  if (
    !Number.isFinite(request.durationSec) ||
    request.durationSec < model.durationSec.min ||
    request.durationSec > model.durationSec.max
  ) {
    fail(`長さは ${String(model.durationSec.min)}〜${String(model.durationSec.max)} 秒にしてください`)
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > model.maxCount) {
    fail(`本数は 1〜${String(model.maxCount)} にしてください`)
  }
  if (request.seed !== null && (!Number.isInteger(request.seed) || request.seed < 0)) {
    fail('種は 0 以上の整数にしてください')
  }
}
