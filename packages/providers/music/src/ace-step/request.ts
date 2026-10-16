import { MUSIC_LYRICS_MAX_LENGTH, MUSIC_PROMPT_MAX_LENGTH } from '@ixa/domain'
import type { MusicGenerationRequest } from '@ixa/provider-core'
import { localServerInputError } from '@ixa/provider-video'
import { ACE_STEP_IDENTITY } from './descriptor.js'

/**
 * 送る前の検査（ace-step-api の契約と同じ範囲）。範囲の外をサーバに送ってから 422 で断られないように。
 * 呼ぶ側（`MusicJobSpec`）でも検査しているが、口が増えたときのためにここでも止める。
 */
export const ensureAceStepRequest = (request: MusicGenerationRequest): void => {
  const fail = (message: string): never => {
    throw localServerInputError(ACE_STEP_IDENTITY, message)
  }
  const { model } = request
  if (request.prompt.trim() === '') fail('曲調が空です')
  if ([...request.prompt].length > MUSIC_PROMPT_MAX_LENGTH) {
    fail(`曲調が ${String(MUSIC_PROMPT_MAX_LENGTH)} 文字を超えています`)
  }
  if ([...request.lyrics].length > MUSIC_LYRICS_MAX_LENGTH) {
    fail(`歌詞が ${String(MUSIC_LYRICS_MAX_LENGTH)} 文字を超えています`)
  }
  if (
    !Number.isFinite(request.durationSec) ||
    request.durationSec < model.durationSec.min ||
    request.durationSec > model.durationSec.max
  ) {
    fail(`長さは ${String(model.durationSec.min)}〜${String(model.durationSec.max)} 秒にしてください`)
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > model.maxCount) {
    fail(`曲の数は 1〜${String(model.maxCount)} にしてください`)
  }
  if (request.seed !== null && (!Number.isInteger(request.seed) || request.seed < 0)) {
    fail('種は 0 以上の整数にしてください')
  }
}
